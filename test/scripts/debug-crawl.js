'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ConfigStore = require('../../src/main/configStore');
const Database = require('../../src/main/database');
const Indexer = require('../../src/main/indexer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-debug-'));
  const docsDir = path.join(tmp, 'Documents');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'alpha.txt'), 'CRIMSONANVIL marker');

  const cfg = new ConfigStore(path.join(tmp, 'config.json'));
  cfg.load();
  cfg.grantPermission();
  cfg.addIncludeDir(docsDir);
  console.log('config:', JSON.stringify(cfg.getAll()));

  const db = new Database(path.join(tmp, 'index.db')).open();
  const indexer = new Indexer({
    db,
    configStore: cfg,
    powerMonitor: null,
    onProgress: (s) => console.log('progress:', JSON.stringify(s)),
    onThrottleChange: (s) => console.log('throttle:', s)
  });
  indexer.throttle.opts.userActiveIdleSec = Number.MAX_VALUE;

  console.log('throttle state before start:', indexer.throttle.state);
  await indexer.start();
  console.log('started, state:', indexer.getStatus());

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    console.log(`t=${(i + 1) * 500}ms state=`, JSON.stringify(indexer.getStatus()), 'files=', db.getStats().fileCount);
    if (indexer.getStatus().state === 'idle' && db.getStats().fileCount > 0) break;
  }

  console.log('search CRIMSONANVIL:', db.search('CRIMSONANVIL').length);
  await indexer.stop();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
