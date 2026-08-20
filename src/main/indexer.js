'use strict';

/**
 * FindAnything - Background File Crawler & Indexing Engine
 * ---------------------------------------------------------
 * Performs deep scans of user-approved directories and keeps the FTS5
 * index current:
 *
 *  - Incremental: maintains internal path -> mtime state so unchanged
 *    files are skipped on subsequent runs.
 *  - Cross-platform pathing: all paths normalized through path.normalize;
 *    Windows backslashes and macOS forward slashes handled transparently.
 *  - Exclusion-aware: never descends into configured system folders.
 *  - Throttled: hooks into ThrottleMonitor; pauses automatically under
 *    CPU pressure or user activity, yielding between files so the event
 *    loop stays responsive.
 *  - Queue-based: the real-time watcher pushes changed paths onto the
 *    same pipeline as the crawler.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Extractor = require('./extractor');
const ThrottleMonitor = require('./throttle');

const BATCH_YIELD_MS = 8; // cooperative yield between files
const PROGRESS_EVERY = 25; // emit progress every N processed files

class Indexer {
  /**
   * @param {object} ctx { db, configStore, powerMonitor, onProgress, onThrottleChange }
   */
  constructor(ctx) {
    this.db = ctx.db;
    this.configStore = ctx.configStore;
    this.onProgress = ctx.onProgress || (() => {});
    this.onThrottleChange = ctx.onThrottleChange || (() => {});

    const cfg = this.configStore.getAll();
    this.extractor = new Extractor({ maxFileSizeMB: cfg.maxFileSizeMB });

    this.throttle = new ThrottleMonitor({
      powerMonitor: ctx.powerMonitor,
      onStateChange: (state, meta) => {
        this.onThrottleChange(state, meta);
      }
    });

    this.state = 'idle'; // idle | crawling | paused
    this.queue = []; // pending paths from the watcher
    this.processedThisRun = 0;
    this.errorsThisRun = 0;
    this._crawlRunning = false;
    this._crawlRequested = false;
    this._stopped = false;
  }

  async start() {
    this._stopped = false;
    this.throttle.start();
    this.scheduleCrawl();
  }

  async stop() {
    this._stopped = true;
    this.throttle.stop();
  }

  pause(reason) {
    if (reason === 'user') this.throttle.setManualPause(true);
    if (this.state !== 'paused') {
      this.state = 'paused';
      this.onThrottleChange('paused', { manual: true });
    }
  }

  resume(reason) {
    if (reason === 'user') this.throttle.setManualPause(false);
    if (this.state === 'paused') {
      this.state = 'idle';
      this.onThrottleChange('running', { manual: true });
      this.scheduleCrawl();
    }
  }

  /** Enqueue a single changed/created path from the file watcher. */
  enqueuePath(filePath) {
    this.queue.push(path.normalize(filePath));
    this._drainQueueSoon();
  }

  /** Remove a deleted path from the index immediately. */
  removePath(filePath) {
    try {
      this.db.deleteFile(path.normalize(filePath));
    } catch (err) {
      console.error('Indexer: failed to remove', filePath, err.message);
    }
  }

  /** Request a crawl pass over all approved directories. */
  scheduleCrawl(options = {}) {
    if (this._stopped) return;
    this._fullRequested = this._fullRequested || !!options.full;
    if (this._crawlRunning) {
      this._crawlRequested = true;
      return;
    }
    this._crawlRequested = true;
    setImmediate(() => this._crawlLoop());
  }

  getStatus() {
    return {
      state: this.state,
      queued: this.queue.length,
      processedThisRun: this.processedThisRun,
      errorsThisRun: this.errorsThisRun,
      throttle: this.throttle.state
    };
  }

  // ---------------- internal ----------------

  _drainQueueSoon() {
    if (this._drainScheduled) return;
    this._drainScheduled = true;
    setImmediate(async () => {
      this._drainScheduled = false;
      await this._drainQueue();
    });
  }

  async _drainQueue() {
    while (this.queue.length > 0 && !this._stopped) {
      await this._waitIfThrottled();
      if (this._stopped) break;
      const filePath = this.queue.shift();
      await this._indexPath(filePath);
    }
  }

  async _crawlLoop() {
    if (this._crawlRunning) return;
    this._crawlRunning = true;

    while (this._crawlRequested && !this._stopped) {
      this._crawlRequested = false;
      const full = this._fullRequested;
      this._fullRequested = false;
      await this._crawlOnce({ full });
    }

    this._crawlRunning = false;
  }

  async _crawlOnce({ full }) {
    const cfg = this.configStore.getAll();
    if (!cfg.permissionGranted) return;
    if (!cfg.includeDirs || cfg.includeDirs.length === 0) return;

    this.state = 'crawling';
    this.processedThisRun = 0;
    this.errorsThisRun = 0;

    // Snapshot known path state for incremental skip + orphan detection.
    const known = new Map();
    if (!full) {
      for (const row of this.db.getAllPathStates()) {
        known.set(row.path, { mtime: row.modified_at, size: row.size });
      }
    }
    const seen = new Set();

    for (const root of cfg.includeDirs) {
      if (this._stopped) break;
      await this._walk(root, cfg, known, seen);
    }

    // Remove index entries for files that disappeared from approved roots.
    if (!full) {
      for (const knownPath of known.keys()) {
        if (!seen.has(knownPath) && this._isUnderIncludedRoot(knownPath, cfg.includeDirs)) {
          try {
            if (!fs.existsSync(knownPath)) this.db.deleteFile(knownPath);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }

    // Drain anything the watcher queued while crawling.
    await this._drainQueue();

    this.db.optimize();
    this.state = 'idle';
    this._emitProgress();
  }

  async _walk(dir, cfg, known, seen) {
    if (this._stopped) return;
    await this._waitIfThrottled();

    const normalizedDir = path.normalize(dir);
    if (this._isExcluded(normalizedDir, cfg.excludeDirs)) return;

    let entries;
    try {
      entries = await fs.promises.readdir(normalizedDir, { withFileTypes: true });
    } catch (_) {
      return; // unreadable directory — skip silently
    }

    for (const entry of entries) {
      if (this._stopped) return;
      const fullPath = path.join(normalizedDir, entry.name);

      try {
        if (entry.isDirectory()) {
          if (!this._isExcluded(fullPath, cfg.excludeDirs)) {
            await this._walk(fullPath, cfg, known, seen);
          }
        } else if (entry.isFile()) {
          seen.add(fullPath);
          await this._maybeIndexFile(fullPath, known);
        }
        // symlinks / sockets / devices are ignored deliberately
      } catch (err) {
        this.errorsThisRun++;
      }

      // Cooperative yield so the main process never blocks.
      await sleep(BATCH_YIELD_MS);
    }
  }

  async _maybeIndexFile(filePath, known) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      return;
    }

    const prev = known.get(filePath);
    if (prev && prev.mtime === stat.mtimeMs && prev.size === stat.size) {
      return; // unchanged — incremental skip
    }

    await this._indexPath(filePath, stat);
  }

  async _indexPath(filePath, stat) {
    try {
      const normalized = path.normalize(filePath);
      if (!stat) {
        try {
          stat = fs.statSync(normalized);
        } catch (_) {
          this.db.deleteFile(normalized); // vanished between event and read
          return;
        }
      }
      if (!stat.isFile()) return;

      const extracted = await this.extractor.extract(normalized);

      this.db.upsertFile({
        path: normalized,
        fileName: path.basename(normalized),
        extension: path.extname(normalized).toLowerCase(),
        size: stat.size,
        modifiedAt: Math.round(stat.mtimeMs),
        indexedAt: Date.now(),
        contentHash: null,
        content: extracted.content,
        status: 'ok'
      });

      this.processedThisRun++;
      if (this.processedThisRun % PROGRESS_EVERY === 0) this._emitProgress();
    } catch (err) {
      // A single bad file must never abort the crawl.
      this.errorsThisRun++;
      console.error('Indexer: failed on', filePath, '-', err.message);
    }
  }

  _isExcluded(filePath, excludeDirs) {
    const normalized = path.normalize(filePath);
    for (const ex of excludeDirs || []) {
      const exNorm = path.normalize(ex);
      if (normalized === exNorm) return true;
      if (normalized.startsWith(exNorm + path.sep)) return true;
      // Windows case-insensitivity
      if (process.platform === 'win32' &&
          normalized.toLowerCase().startsWith(exNorm.toLowerCase() + path.sep)) {
        return true;
      }
    }
    return false;
  }

  _isUnderIncludedRoot(filePath, includeDirs) {
    const normalized = path.normalize(filePath);
    return (includeDirs || []).some((root) => {
      const r = path.normalize(root);
      return normalized === r || normalized.startsWith(r + path.sep);
    });
  }

  async _waitIfThrottled() {
    while (this.throttle.state !== 'running' && !this._stopped) {
      if (this.state !== 'paused') {
        this.state = 'paused';
        this._emitProgress();
      }
      await sleep(500);
    }
    if (!this._stopped && this.state === 'paused') {
      this.state = 'crawling';
      this._emitProgress();
    }
  }

  _emitProgress() {
    this.onProgress(this.getStatus());
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = Indexer;
