import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom APIs for renderer
const api = {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),

  // Database operations
  db: {
    getAll: (table: string, tenantId: string) => ipcRenderer.invoke('db:getAll', table, tenantId),
    getById: (table: string, id: string) => ipcRenderer.invoke('db:getById', table, id),
    insert: (table: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('db:insert', table, data),
    update: (table: string, id: string, data: Record<string, unknown>) =>
      ipcRenderer.invoke('db:update', table, id, data),
    delete: (table: string, id: string) => ipcRenderer.invoke('db:delete', table, id),
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    addToSyncQueue: (item: Record<string, unknown>) =>
      ipcRenderer.invoke('db:addToSyncQueue', item),
    getPendingSyncItems: (tenantId: string) =>
      ipcRenderer.invoke('db:getPendingSyncItems', tenantId),
  },

  // Sync operations
  sync: {
    getStatus: () => ipcRenderer.invoke('sync:getStatus'),
    triggerSync: () => ipcRenderer.invoke('sync:triggerSync'),
    setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('sync:setConfig', config),
  },
};

// Expose APIs to renderer process
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}
