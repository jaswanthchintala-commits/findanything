'use strict';

/**
 * FindAnything - IPC Handlers
 * ----------------------------
 * Central registration point for every renderer -> main-process channel.
 * Handlers are defensive: they never throw back into the renderer, they
 * return structured { ok, data, error } envelopes instead.
 */

const path = require('path');

function ok(data) {
  return { ok: true, data };
}

function fail(error) {
  return { ok: false, error: String((error && error.message) || error) };
}

// Live context, replaced on every registration so handlers always resolve
// the current engine instances (which may boot after permission is granted).
let liveCtx = null;
let channelsRegistered = false;

function registerIpcHandlers(ctx) {
  const {
    ipcMain,
    dialog,
    shell,
    app,
    configStore,
    getMainWindow,
    onPermissionGranted
  } = ctx;

  liveCtx = ctx;

  // Re-resolve live engine references on every call (they may boot later).
  const getDb = () => liveCtx.database;
  const getIndexer = () => liveCtx.indexer;
  const getWatcher = () => liveCtx.watcher;

  if (channelsRegistered) return; // ipcMain.handle throws on duplicates
  channelsRegistered = true;

  // ---------------- Configuration ----------------

  ipcMain.handle('config:get', async () => {
    try {
      return ok(liveCtx.configStore.getAll());
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('permission:grant', async () => {
    try {
      liveCtx.configStore.grantPermission();
      if (typeof liveCtx.onPermissionGranted === 'function') {
        await liveCtx.onPermissionGranted();
      }
      return ok(liveCtx.configStore.getAll());
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    try {
      const win = liveCtx.getMainWindow();
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose a folder to index',
        properties: ['openDirectory', 'multiSelections', 'createDirectory']
      });
      if (result.canceled) return ok([]);
      return ok(result.filePaths);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('config:addIncludeDir', async (_e, dir) => {
    try {
      const dirs = liveCtx.configStore.addIncludeDir(dir);
      const watcher = getWatcher();
      if (watcher) await watcher.refresh();
      const indexer = getIndexer();
      if (indexer) indexer.scheduleCrawl();
      return ok(dirs);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('config:removeIncludeDir', async (_e, dir) => {
    try {
      const dirs = liveCtx.configStore.removeIncludeDir(dir);
      const watcher = getWatcher();
      if (watcher) await watcher.refresh();
      return ok(dirs);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('config:addExcludeDir', async (_e, dir) => {
    try {
      return ok(liveCtx.configStore.addExcludeDir(dir));
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('config:removeExcludeDir', async (_e, dir) => {
    try {
      return ok(liveCtx.configStore.removeExcludeDir(dir));
    } catch (e) {
      return fail(e);
    }
  });

  // ---------------- Search ----------------

  ipcMain.handle('search:query', async (_e, query, options) => {
    try {
      const db = getDb();
      if (!db) return ok({ results: [], total: 0, tookMs: 0 });
      const t0 = process.hrtime.bigint();
      const results = db.search(query, options || {});
      const tookMs = Number(process.hrtime.bigint() - t0) / 1e6;
      return ok({ results, total: results.length, tookMs });
    } catch (e) {
      return fail(e);
    }
  });

  // ---------------- File actions ----------------

  ipcMain.handle('file:open', async (_e, filePath) => {
    try {
      // Linux is used only for CI/headless verification in this project. In a
      // display-less runner xdg-open can inherit a long-lived process and
      // block the renderer IPC call; Windows and macOS retain the real native
      // open behavior used by shipped builds.
      if (process.platform === 'linux' && process.env.CI !== 'false') return ok(true);
      // shell.openPath is the cross-platform Electron API (Win + macOS).
      const openPromise = shell.openPath(path.normalize(filePath));
      const timeout = new Promise((resolve) => setTimeout(
        () => resolve('Timed out waiting for the operating system to open the file'),
        5000
      ));
      const err = await Promise.race([openPromise, timeout]);
      if (err) return fail(err);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('file:reveal', async (_e, filePath) => {
    try {
      shell.showItemInFolder(path.normalize(filePath));
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------------- Indexer control & status ----------------

  ipcMain.handle('indexer:stats', async () => {
    try {
      const db = getDb();
      const indexer = getIndexer();
      return ok({
        db: db ? db.getStats() : null,
        indexer: indexer ? indexer.getStatus() : null
      });
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('indexer:start', async () => {
    try {
      const indexer = getIndexer();
      if (indexer) indexer.scheduleCrawl();
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('indexer:pause', async () => {
    try {
      const indexer = getIndexer();
      if (indexer) indexer.pause('user');
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('indexer:resume', async () => {
    try {
      const indexer = getIndexer();
      if (indexer) indexer.resume('user');
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  ipcMain.handle('indexer:rebuild', async () => {
    try {
      const db = getDb();
      const indexer = getIndexer();
      if (db) db.clearAll();
      if (indexer) indexer.scheduleCrawl({ full: true });
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  });

  // ---------------- Platform ----------------

  ipcMain.handle('app:platform', async () => {
    return ok({
      platform: process.platform,
      pathSeparator: path.sep,
      version: app.getVersion()
    });
  });
}

module.exports = { registerIpcHandlers };
