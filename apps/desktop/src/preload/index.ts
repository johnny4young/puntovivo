import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for exposed API
export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  getThemePreference: () => Promise<'light' | 'dark' | 'system'>;
  updateThemePreference: (
    preference: 'light' | 'dark' | 'system'
  ) => Promise<'light' | 'dark' | 'system'>;
  getReceiptPrintSettings: () => Promise<{
    silent: boolean;
    printBackground: boolean;
  }>;
  updateReceiptPrintSettings: (settings: {
    silent: boolean;
    printBackground: boolean;
  }) => Promise<{
    silent: boolean;
    printBackground: boolean;
  }>;
  createDatabaseBackup: () => Promise<{
    success: boolean;
    cancelled: boolean;
    path?: string;
    error?: string;
  }>;
  restoreDatabaseBackup: () => Promise<{
    success: boolean;
    cancelled: boolean;
    path?: string;
    error?: string;
  }>;
  printReceipt: (receiptHtml: string) => Promise<{ success: boolean; error?: string }>;
}

export interface DatabaseAPI {
  getAll: (table: string, tenantId: string) => Promise<unknown[]>;
  getById: (table: string, id: string) => Promise<unknown>;
  insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  delete: (table: string, id: string) => Promise<boolean>;
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  addToSyncQueue: (item: Record<string, unknown>) => Promise<void>;
  getPendingSyncItems: (tenantId: string) => Promise<unknown[]>;
}

export interface SyncAPI {
  getStatus: () => Promise<{ isOnline: boolean; lastSync: string | null; pendingItems: number }>;
  triggerSync: () => Promise<{ success: boolean; synced: number; errors: string[] }>;
  setConfig: (config: Record<string, unknown>) => Promise<void>;
}

export interface DesktopBridgeAPI extends ElectronAPI {
  db: DatabaseAPI;
  sync: SyncAPI;
}

// Custom APIs for renderer
const electronAPI: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getThemePreference: () => ipcRenderer.invoke('get-theme-preference'),
  updateThemePreference: preference => ipcRenderer.invoke('update-theme-preference', preference),
  getReceiptPrintSettings: () => ipcRenderer.invoke('get-receipt-print-settings'),
  updateReceiptPrintSettings: settings =>
    ipcRenderer.invoke('update-receipt-print-settings', settings),
  createDatabaseBackup: () => ipcRenderer.invoke('create-database-backup'),
  restoreDatabaseBackup: () => ipcRenderer.invoke('restore-database-backup'),
  printReceipt: (receiptHtml: string) => ipcRenderer.invoke('print-receipt', receiptHtml),
};

const dbAPI: DatabaseAPI = {
  getAll: (table: string, tenantId: string) => ipcRenderer.invoke('db:getAll', table, tenantId),
  getById: (table: string, id: string) => ipcRenderer.invoke('db:getById', table, id),
  insert: (table: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('db:insert', table, data),
  update: (table: string, id: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('db:update', table, id, data),
  delete: (table: string, id: string) => ipcRenderer.invoke('db:delete', table, id),
  query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
  addToSyncQueue: (item: Record<string, unknown>) => ipcRenderer.invoke('db:addToSyncQueue', item),
  getPendingSyncItems: (tenantId: string) => ipcRenderer.invoke('db:getPendingSyncItems', tenantId),
};

const syncAPI: SyncAPI = {
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  triggerSync: () => ipcRenderer.invoke('sync:triggerSync'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('sync:setConfig', config),
};

const desktopBridgeAPI: DesktopBridgeAPI = {
  ...electronAPI,
  db: dbAPI,
  sync: syncAPI,
};

// Expose APIs to renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('db', dbAPI);
contextBridge.exposeInMainWorld('sync', syncAPI);
contextBridge.exposeInMainWorld('api', desktopBridgeAPI);
