'use strict';

/**
 * FindAnything - Native File Watcher
 * -----------------------------------
 * Uses chokidar to interface directly with native OS kernel APIs
 * (ReadDirectoryChangesW on Windows, FSEvents on macOS, inotify on Linux)
 * so file creation, modification and deletion events are captured
 * instantly and pushed into the indexing pipeline.
 *
 *  - Watches exactly the user-approved include directories.
 *  - Ignores configured system/excluded folders at the source.
 *  - Debounces rapid event bursts per path (editors often emit several
 *    change events for one save).
 *  - refresh() re-syncs the watch set whenever the configuration changes.
 */

const path = require('path');
const chokidar = require('chokidar');

const EVENT_DEBOUNCE_MS = 300;

class Watcher {
  /**
   * @param {object} ctx { indexer, configStore }
   */
  constructor(ctx) {
    this.indexer = ctx.indexer;
    this.configStore = ctx.configStore;
    this.watcher = null;
    this._pending = new Map(); // path -> timer (event debounce)
  }

  async start() {
    const cfg = this.configStore.getAll();
    if (!cfg.permissionGranted) return;
    if (!cfg.includeDirs || cfg.includeDirs.length === 0) return;

    this.watcher = chokidar.watch(cfg.includeDirs, {
      persistent: true,
      ignoreInitial: true, // the crawler handles the initial bulk pass
      depth: Infinity,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100
      },
      ignored: (filePath) => this._isExcluded(filePath, cfg.excludeDirs),
      usePolling: false // native OS APIs: FSEvents / ReadDirectoryChangesW
    });

    this.watcher.on('add', (p) => this._debounced(p, () => this.indexer.enqueuePath(p)));
    this.watcher.on('change', (p) => this._debounced(p, () => this.indexer.enqueuePath(p)));
    this.watcher.on('unlink', (p) => this._debounced(p, () => this.indexer.removePath(p)));
    this.watcher.on('error', (err) => console.error('Watcher error:', err.message));
  }

  async stop() {
    for (const timer of this._pending.values()) clearTimeout(timer);
    this._pending.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /** Re-sync watched roots after configuration changes. */
  async refresh() {
    await this.stop();
    await this.start();
  }

  _debounced(filePath, fn) {
    const key = path.normalize(filePath);
    const existing = this._pending.get(key);
    if (existing) clearTimeout(existing);
    this._pending.set(
      key,
      setTimeout(() => {
        this._pending.delete(key);
        try {
          fn();
        } catch (err) {
          console.error('Watcher handler failed for', key, err.message);
        }
      }, EVENT_DEBOUNCE_MS)
    );
  }

  _isExcluded(filePath, excludeDirs) {
    const normalized = path.normalize(filePath);
    return (excludeDirs || []).some((ex) => {
      const exNorm = path.normalize(ex);
      return normalized === exNorm || normalized.startsWith(exNorm + path.sep);
    });
  }
}

module.exports = Watcher;
