'use strict';

/**
 * FindAnything - Configuration Store
 * -----------------------------------
 * Persists all user configuration to a local JSON file inside the OS
 * userData directory. Nothing ever leaves the local machine.
 *
 * Stored settings:
 *  - permissionGranted : whether the user explicitly authorized indexing
 *  - includeDirs       : folders / drives approved for crawling
 *  - excludeDirs       : system / user folders that must never be crawled
 *  - maxFileSizeMB     : safety ceiling for deep text extraction
 *  - firstLaunchAt     : ISO timestamp of first run
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Default OS-specific system folders that are always excluded. */
function defaultExcludes() {
  const home = os.homedir();
  const common = [
    path.join(home, '.Trash'),
    path.join(home, '.cache'),
    path.join(home, '.npm'),
    path.join(home, '.config')
  ];
  if (process.platform === 'win32') {
    return [
      'C:\\Windows',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\$Recycle.Bin',
      path.join(home, 'AppData')
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/System',
      '/Library',
      '/private',
      '/Volumes',
      path.join(home, 'Library')
    ];
  }
  // Linux / other. Note: /tmp is intentionally NOT excluded — users may
  // legitimately keep files there, and explicit user-approved roots win.
  return ['/proc', '/sys', '/dev', ...common];
}

const DEFAULTS = () => ({
  version: 1,
  permissionGranted: false,
  includeDirs: [],
  excludeDirs: defaultExcludes(),
  maxFileSizeMB: 50,
  firstLaunchAt: new Date().toISOString()
});

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = DEFAULTS();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = Object.assign(DEFAULTS(), parsed);
      } else {
        this.save();
      }
    } catch (err) {
      console.error('ConfigStore: failed to load config, using defaults:', err);
      this.data = DEFAULTS();
    }
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath); // atomic replace
    } catch (err) {
      console.error('ConfigStore: failed to save config:', err);
    }
  }

  getAll() {
    return JSON.parse(JSON.stringify(this.data));
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  grantPermission() {
    this.data.permissionGranted = true;
    this.save();
  }

  addIncludeDir(dir) {
    const normalized = path.normalize(dir);
    if (!this.data.includeDirs.includes(normalized)) {
      this.data.includeDirs.push(normalized);
      this.save();
    }
    return this.data.includeDirs;
  }

  removeIncludeDir(dir) {
    this.data.includeDirs = this.data.includeDirs.filter((d) => d !== dir);
    this.save();
    return this.data.includeDirs;
  }

  addExcludeDir(dir) {
    const normalized = path.normalize(dir);
    if (!this.data.excludeDirs.includes(normalized)) {
      this.data.excludeDirs.push(normalized);
      this.save();
    }
    return this.data.excludeDirs;
  }

  removeExcludeDir(dir) {
    this.data.excludeDirs = this.data.excludeDirs.filter((d) => d !== dir);
    this.save();
    return this.data.excludeDirs;
  }
}

module.exports = ConfigStore;
