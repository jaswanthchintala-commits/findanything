'use strict';

/**
 * FindAnything - Main Process Entry Point
 * ----------------------------------------
 * Super Google Desktop: instant deep-content local file search.
 * Handles application lifecycle, the main BrowserWindow, first-launch
 * permission gating, and wiring of all core engine subsystems.
 */

const { app, BrowserWindow, shell, dialog, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const ConfigStore = require('./configStore');
const Database = require('./database');
const Indexer = require('./indexer');
const Watcher = require('./watcher');
const { registerIpcHandlers } = require('./ipc');

const isDev = process.argv.includes('--dev');

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {ConfigStore|null} */
let configStore = null;
/** @type {Database|null} */
let database = null;
/** @type {Indexer|null} */
let indexer = null;
/** @type {Watcher|null} */
let watcher = null;

/**
 * Resolve the per-user data directory. All configuration, the FTS5 index
 * database and extracted metadata live strictly on the local machine.
 * ELECTRON_USER_DATA_DIR allows tests/CI to redirect storage hermetically.
 */
function getUserDataDir() {
  if (process.env.ELECTRON_USER_DATA_DIR) {
    return process.env.ELECTRON_USER_DATA_DIR;
  }
  return app.getPath('userData');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'FindAnything',
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Open any external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Boot the engine subsystems. Called only AFTER the user has granted
 * storage permission (or when permission was granted on a previous run).
 */
async function bootEngine() {
  try {
    console.log('[FindAnything] bootEngine: starting');
    const cfg = configStore.getAll();

    database = new Database(path.join(getUserDataDir(), 'findanything-index.db'));
    database.open();
    console.log('[FindAnything] database opened');

  indexer = new Indexer({
    db: database,
    configStore,
    powerMonitor,
    onProgress: (stats) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('indexer:progress', stats);
      }
    },
    onThrottleChange: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('indexer:throttle', state);
      }
    }
  });

  watcher = new Watcher({
    indexer,
    configStore
  });

  registerIpcHandlers({
    ipcMain,
    dialog,
    shell,
    app,
    configStore,
    database,
    indexer,
    watcher,
    getMainWindow: () => mainWindow
  });

    // Start watching approved directories and kick off an incremental crawl.
    await indexer.start();
    console.log('[FindAnything] indexer started');
    await watcher.start();
    console.log('[FindAnything] watcher started, boot complete');
  } catch (err) {
    console.error('[FindAnything] bootEngine FAILED:', err);
  }
}

app.whenReady().then(async () => {
  // Ensure the local data directory exists.
  fs.mkdirSync(getUserDataDir(), { recursive: true });

  configStore = new ConfigStore(path.join(getUserDataDir(), 'findanything-config.json'));
  configStore.load();

  createMainWindow();

  const cfg = configStore.getAll();
  if (cfg.permissionGranted) {
    await bootEngine();
  } else {
    // Register a minimal IPC surface so the permission modal can grant access.
    registerIpcHandlers({
      ipcMain,
      dialog,
      shell,
      app,
      configStore,
      database: null,
      indexer: null,
      watcher: null,
      getMainWindow: () => mainWindow,
      onPermissionGranted: async () => {
        await bootEngine();
      }
    });
  }

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS apps conventionally stay alive until Cmd+Q.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try {
    if (watcher) await watcher.stop();
    if (indexer) await indexer.stop();
    if (database) database.close();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
});
