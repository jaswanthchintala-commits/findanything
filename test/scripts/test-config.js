'use strict';

/** Phase 1 verification: ConfigStore persistence & permission flow. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const ConfigStore = require('../../src/main/configStore');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-config-'));
const cfgPath = path.join(tmp, 'config.json');

// 1. Fresh store starts with permission denied and default excludes.
const store = new ConfigStore(cfgPath);
store.load();
assert.strictEqual(store.get('permissionGranted'), false, 'permission must start denied');
assert.ok(Array.isArray(store.get('excludeDirs')), 'excludeDirs must be an array');
assert.ok(store.get('excludeDirs').length > 0, 'default excludes must exist');
assert.ok(fs.existsSync(cfgPath), 'config JSON must be written to disk');

// 2. Granting permission persists across reload.
store.grantPermission();
const store2 = new ConfigStore(cfgPath);
store2.load();
assert.strictEqual(store2.get('permissionGranted'), true, 'permission must persist');

// 3. Include/exclude management with normalization and dedupe.
store2.addIncludeDir(tmp);
store2.addIncludeDir(tmp); // duplicate must be ignored
assert.strictEqual(store2.get('includeDirs').length, 1, 'duplicate include dirs must be deduped');
store2.addExcludeDir(path.join(tmp, 'sub'));
store2.removeIncludeDir(tmp);
assert.strictEqual(store2.get('includeDirs').length, 0, 'include dir removal must work');

// 4. Config file is valid JSON on disk.
const onDisk = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
assert.strictEqual(onDisk.permissionGranted, true);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS: Phase 1 - ConfigStore permission & directory configuration tests');
