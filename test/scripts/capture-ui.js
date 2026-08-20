'use strict';

/**
 * Capture real screenshots of the FindAnything UI for visual verification:
 *   1. Permission modal (first launch)
 *   2. Search results with highlighted snippets (Google Desktop layout)
 *   3. Settings panel
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ELECTRON = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron');
const APP_DIR = path.join(__dirname, '..', '..');
const CDP_PORT = 9224;
const OUT_DIR = path.join(__dirname, '..', 'screenshots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

async function waitForCdp(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const targets = await getJson(`http://127.0.0.1:${CDP_PORT}/json`);
      const page = targets.find((t) => t.type === 'page');
      if (page) return page;
    } catch (_) {}
    await sleep(300);
  }
  throw new Error('CDP endpoint never came up');
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      const WS = require('ws');
      this.ws = new WS(this.wsUrl, { perMessageDeflate: false });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }
  async screenshot(file) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('  saved', file);
  }
  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function waitFor(condFn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await condFn()) return;
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('TIMEOUT: ' + label);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-shots-'));
  const userData = path.join(tmp, 'userData');
  const docsDir = path.join(tmp, 'My Documents');
  fs.mkdirSync(docsDir, { recursive: true });

  fs.writeFileSync(
    path.join(docsDir, 'Project Roadmap.txt'),
    'FindAnything roadmap\n\nThe instant search engine indexes every document deeply.\n' +
      'Our roadmap includes real-time watching, hardware throttling and snippet highlighting.\n' +
      'The roadmap milestone ships in Q3 with full PDF and Word support.\n'
  );
  fs.writeFileSync(
    path.join(docsDir, 'meeting-notes.md'),
    '# Meeting Notes\n\nDiscussed the roadmap review process.\nAction items assigned to the team.\n'
  );
  fs.writeFileSync(
    path.join(docsDir, 'budget-2026.csv'),
    'item,amount\nroadmap research,5000\ninfrastructure,12000\n'
  );

  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'findanything-config.json'),
    JSON.stringify({
      version: 1,
      permissionGranted: false,
      includeDirs: [docsDir],
      excludeDirs: [],
      maxFileSizeMB: 50,
      firstLaunchAt: new Date().toISOString()
    })
  );

  const electron = spawn(
    ELECTRON,
    [APP_DIR, '--remote-debugging-port=' + CDP_PORT, '--no-sandbox'],
    {
      env: Object.assign({}, process.env, {
        ELECTRON_USER_DATA_DIR: userData,
        FA_USER_ACTIVE_IDLE_SEC: '0'
      }),
      stdio: ['ignore', 'ignore', 'ignore']
    }
  );

  try {
    const page = await waitForCdp(30000);
    const cdp = new CdpClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // 1. Permission modal
    await waitFor(
      () => cdp.eval(`!document.getElementById('permission-overlay').classList.contains('hidden')`),
      15000,
      'permission modal'
    );
    await sleep(600);
    await cdp.screenshot(path.join(OUT_DIR, '1-permission-modal.png'));

    // Grant + index
    await cdp.eval(`window.findanything.grantPermission()`);
    await cdp.eval(`window.findanything.addIncludeDir(${JSON.stringify(docsDir)})`);
    await cdp.eval(`
      document.getElementById('permission-overlay').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      document.getElementById('settings-overlay').classList.add('hidden');
    `);

    await waitFor(async () => {
      const n = await cdp.eval(
        `window.findanything.getIndexStats().then(r => r.ok && r.data.db ? r.data.db.fileCount : 0)`
      );
      return n >= 3;
    }, 30000, 'files indexed');

    // 2. Search results
    await cdp.eval(`
      const input = document.getElementById('search-input');
      input.value = 'roadmap';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await waitFor(
      () => cdp.eval(`document.querySelectorAll('.result-item').length >= 2`),
      10000,
      'results rendered'
    );
    await sleep(400);
    await cdp.screenshot(path.join(OUT_DIR, '2-search-results.png'));

    // 3. Settings panel
    await cdp.eval(`document.getElementById('btn-settings').click()`);
    await sleep(600);
    await cdp.screenshot(path.join(OUT_DIR, '3-settings-panel.png'));

    cdp.close();
    console.log('PASS: screenshots captured');
    setTimeout(() => process.exit(0), 1000);
  } finally {
    try { electron.kill('SIGKILL'); } catch (_) {}
  }
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
