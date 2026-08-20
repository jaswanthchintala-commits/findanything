'use strict';

/**
 * Phase 4 verification: background crawler, incremental re-crawl,
 * real-time watcher events (add/change/unlink), exclusion handling,
 * and throttle monitor behavior — all without Electron (headless).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ConfigStore = require('../../src/main/configStore');
const Database = require('../../src/main/database');
const Indexer = require('../../src/main/indexer');
const Watcher = require('../../src/main/watcher');
const ThrottleMonitor = require('../../src/main/throttle');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(100);
  }
  throw new Error('TIMEOUT waiting for: ' + label);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-engine-'));
  const docsDir = path.join(tmp, 'Documents');
  const excludedDir = path.join(docsDir, 'System Junk');
  fs.mkdirSync(excludedDir, { recursive: true });

  // Seed some files.
  fs.writeFileSync(path.join(docsDir, 'alpha.txt'), 'The CRIMSONANVIL marker lives here.');
  fs.writeFileSync(path.join(docsDir, 'beta.md'), '# Notes\nEMERALDSADDLE appears in markdown.');
  fs.writeFileSync(path.join(excludedDir, 'secret.txt'), 'HIDDENMARKER must never be indexed');

  const cfg = new ConfigStore(path.join(tmp, 'config.json'));
  cfg.load();
  cfg.grantPermission();
  cfg.addIncludeDir(docsDir);
  cfg.addExcludeDir(excludedDir);

  const db = new Database(path.join(tmp, 'index.db')).open();

  // ---------- 1. Initial crawl ----------
  const indexer = new Indexer({
    db,
    configStore: cfg,
    powerMonitor: null, // headless: user counts as idle
    onProgress: () => {},
    onThrottleChange: () => {}
  });

  // Headless: no powerMonitor -> idle seconds = Infinity. A huge activity
  // window makes Infinity compare as 'not active', keeping the indexer running.
  indexer.throttle.opts.userActiveIdleSec = Number.MAX_VALUE;

  await indexer.start();
  await waitFor(
    () => indexer.getStatus().state === 'idle' && db.getStats().fileCount >= 2,
    20000,
    'initial crawl to index 2 files'
  );

  assert.ok(db.search('CRIMSONANVIL').length === 1, 'alpha.txt content must be searchable');
  assert.ok(db.search('EMERALDSADDLE').length === 1, 'beta.md content must be searchable');
  assert.strictEqual(db.search('HIDDENMARKER').length, 0, 'excluded folder must not be indexed');
  console.log('  initial crawl: 2 files indexed, exclusion respected');

  // ---------- 2. Incremental re-crawl skips unchanged files ----------
  const before = db.getFile(path.join(docsDir, 'alpha.txt'));
  indexer.scheduleCrawl();
  await waitFor(() => indexer.getStatus().state === 'idle', 20000, 'incremental crawl');
  const after = db.getFile(path.join(docsDir, 'alpha.txt'));
  assert.strictEqual(after.indexed_at, before.indexed_at, 'unchanged file must be skipped');
  console.log('  incremental crawl: unchanged files skipped');

  // ---------- 3. Real-time watcher: add / change / unlink ----------
  const watcher = new Watcher({ indexer, configStore: cfg });
  await watcher.start();
  await sleep(500); // let chokidar attach

  // add
  fs.writeFileSync(path.join(docsDir, 'gamma.txt'), 'Fresh file with TOPAZLANTERN inside.');
  await waitFor(() => db.search('TOPAZLANTERN').length === 1, 15000, 'watcher add event');
  console.log('  watcher: file creation indexed in real time');

  // change
  fs.writeFileSync(path.join(docsDir, 'gamma.txt'), 'Updated content now holds SAPPHIRELOOM.');
  await waitFor(() => db.search('SAPPHIRELOOM').length === 1, 15000, 'watcher change event');
  assert.strictEqual(db.search('TOPAZLANTERN').length, 0, 'old content must be replaced');
  console.log('  watcher: file modification re-indexed in real time');

  // unlink
  fs.unlinkSync(path.join(docsDir, 'gamma.txt'));
  await waitFor(() => db.search('SAPPHIRELOOM').length === 0, 15000, 'watcher unlink event');
  console.log('  watcher: file deletion removed from index in real time');

  // ---------- 4. Throttle monitor behavior ----------
  const states = [];
  const tm = new ThrottleMonitor({
    powerMonitor: null,
    onStateChange: (s) => states.push(s),
    overrides: { cpuHighWater: -1, cpuLowWater: 999, userActiveIdleSec: Number.MAX_VALUE }
  });
  tm._sample(); // cpu pressure -1 forces pause
  assert.strictEqual(tm.state, 'paused', 'high CPU pressure must pause');
  tm.opts.cpuHighWater = 0.55; // restore
  tm._sample(); // low water 999 -> resume
  assert.strictEqual(tm.state, 'running', 'calm CPU must resume');
  tm.setManualPause(true);
  assert.strictEqual(tm.state, 'paused', 'manual pause must hold');
  tm.setManualPause(false);
  assert.strictEqual(tm.state, 'running', 'manual resume must release');
  console.log('  throttle: CPU hysteresis + manual pause/resume verified');

  // ---------- 5. Indexer pause/resume API ----------
  indexer.pause('user');
  assert.strictEqual(indexer.getStatus().state, 'paused');
  indexer.resume('user');
  assert.strictEqual(indexer.getStatus().state !== 'paused', true);
  console.log('  indexer: pause/resume API verified');

  await watcher.stop();
  await indexer.stop();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('PASS: Phase 4 - Crawler, watcher, incremental state & throttling tests');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
