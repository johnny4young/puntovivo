import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for exposed API
export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  getServerUrl: () => Promise<string>;
  getAutoUpdateStatus: () => Promise<{
    isAvailable: boolean;
    state: 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';
    currentVersion: string;
    lastCheckedAt: string | null;
    releaseName: string | null;
    releaseNotes: string | null;
    releaseDate: string | null;
    updateUrl: string | null;
    error: string | null;
    reason: string | null;
  }>;
  checkForAppUpdates: () => Promise<{
    isAvailable: boolean;
    state: 'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';
    currentVersion: string;
    lastCheckedAt: string | null;
    releaseName: string | null;
    releaseNotes: string | null;
    releaseDate: string | null;
    updateUrl: string | null;
    error: string | null;
    reason: string | null;
  }>;
  restartToApplyAppUpdate: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  getTraySettings: () => Promise<{
    enabled: boolean;
    closeToTray: boolean;
  }>;
  updateTraySettings: (settings: {
    enabled: boolean;
    closeToTray: boolean;
  }) => Promise<{
    enabled: boolean;
    closeToTray: boolean;
  }>;
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
  getByField: (table: string, fieldName: string, value: unknown) => Promise<unknown[]>;
  deleteByTenant: (table: string, tenantId: string) => Promise<number>;
  countByTenant: (table: string, tenantId: string) => Promise<number>;
  addToSyncQueue: (item: Record<string, unknown>) => Promise<void>;
  getPendingSyncItems: (tenantId: string) => Promise<unknown[]>;
}

export interface SyncAPI {
  getStatus: (tenantId?: string) => Promise<{
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
    conflicts: number;
  }>;
  triggerSync: (tenantId?: string) => Promise<{
    success: boolean;
    synced: number;
    errors: string[];
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
    conflicts: number;
  }>;
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
  getAutoUpdateStatus: () => ipcRenderer.invoke('get-auto-update-status'),
  checkForAppUpdates: () => ipcRenderer.invoke('check-for-app-updates'),
  restartToApplyAppUpdate: () => ipcRenderer.invoke('restart-to-apply-app-update'),
  getTraySettings: () => ipcRenderer.invoke('get-tray-settings'),
  updateTraySettings: settings => ipcRenderer.invoke('update-tray-settings', settings),
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
  getByField: (table: string, fieldName: string, value: unknown) =>
    ipcRenderer.invoke('db:getByField', table, fieldName, value),
  deleteByTenant: (table: string, tenantId: string) =>
    ipcRenderer.invoke('db:deleteByTenant', table, tenantId),
  countByTenant: (table: string, tenantId: string) =>
    ipcRenderer.invoke('db:countByTenant', table, tenantId),
  addToSyncQueue: (item: Record<string, unknown>) => ipcRenderer.invoke('db:addToSyncQueue', item),
  getPendingSyncItems: (tenantId: string) => ipcRenderer.invoke('db:getPendingSyncItems', tenantId),
};

const syncAPI: SyncAPI = {
  getStatus: (tenantId?: string) => ipcRenderer.invoke('sync:getStatus', tenantId),
  triggerSync: (tenantId?: string) => ipcRenderer.invoke('sync:triggerSync', tenantId),
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
