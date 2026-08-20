'use strict';

/**
 * FindAnything - Preload Script
 * ------------------------------
 * Exposes a minimal, safe API surface to the renderer via contextBridge.
 * The renderer has no direct Node.js access (contextIsolation enabled).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('findanything', {
  // --- Permission & configuration ---
  getConfig: () => ipcRenderer.invoke('config:get'),
  grantPermission: () => ipcRenderer.invoke('permission:grant'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  addIncludeDir: (dir) => ipcRenderer.invoke('config:addIncludeDir', dir),
  removeIncludeDir: (dir) => ipcRenderer.invoke('config:removeIncludeDir', dir),
  addExcludeDir: (dir) => ipcRenderer.invoke('config:addExcludeDir', dir),
  removeExcludeDir: (dir) => ipcRenderer.invoke('config:removeExcludeDir', dir),

  // --- Search ---
  search: (query, options) => ipcRenderer.invoke('search:query', query, options),

  // --- File actions ---
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),

  // --- Indexer control & status ---
  getIndexStats: () => ipcRenderer.invoke('indexer:stats'),
  startIndexing: () => ipcRenderer.invoke('indexer:start'),
  pauseIndexing: () => ipcRenderer.invoke('indexer:pause'),
  resumeIndexing: () => ipcRenderer.invoke('indexer:resume'),
  rebuildIndex: () => ipcRenderer.invoke('indexer:rebuild'),

  // --- Platform info (for OS-correct path rendering) ---
  getPlatform: () => ipcRenderer.invoke('app:platform'),

  // --- Event subscriptions (return an unsubscribe function) ---
  onIndexerProgress: (callback) => {
    const listener = (_event, stats) => callback(stats);
    ipcRenderer.on('indexer:progress', listener);
    return () => ipcRenderer.removeListener('indexer:progress', listener);
  },
  onThrottleChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('indexer:throttle', listener);
    return () => ipcRenderer.removeListener('indexer:throttle', listener);
  }
});
