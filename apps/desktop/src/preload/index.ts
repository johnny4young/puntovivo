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
  updateMainLocale: (locale: string) => Promise<'en' | 'es'>;
}

/**
 * ENG-025 vector 1 — the `tenantId` argument is no longer accepted on
 * tenant-scoped methods. Main process derives it from the registered
 * desktopSession (set via `session.register` after login). Legacy
 * arities are kept marked deprecated for one release so the
 * IndexedDB browser fallback can keep its current call shape; the
 * Electron path drops them.
 */
export interface DatabaseAPI {
  getAll: (table: string) => Promise<unknown[]>;
  getById: (table: string, id: string) => Promise<unknown>;
  insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  delete: (table: string, id: string) => Promise<boolean>;
  getByField: (table: string, fieldName: string, value: unknown) => Promise<unknown[]>;
  deleteByTenant: (table: string) => Promise<number>;
  countByTenant: (table: string) => Promise<number>;
  addToSyncQueue: (item: Record<string, unknown>) => Promise<void>;
  getPendingSyncItems: () => Promise<unknown[]>;
}

export interface SyncAPI {
  getStatus: () => Promise<{
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
    conflicts: number;
  }>;
  triggerSync: () => Promise<{
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

/**
 * ENG-025 vector 1 — desktop session lifecycle. Renderer's
 * AuthProvider calls `register(accessToken)` after a successful login
 * (and after every successful `auth.refresh` rotation), and `clear()`
 * after logout. Until `register` succeeds, every `db.*` / `sync.*`
 * call rejects with `SESSION_NOT_REGISTERED`.
 */
export interface SessionAPI {
  register: (accessToken: string) => Promise<{ ok: true }>;
  clear: () => Promise<{ ok: true }>;
}

export interface DesktopBridgeAPI extends ElectronAPI {
  db: DatabaseAPI;
  sync: SyncAPI;
  session: SessionAPI;
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
  updateMainLocale: (locale: string) => ipcRenderer.invoke('update-main-locale', locale),
};

const dbAPI: DatabaseAPI = {
  // ENG-025 vector 1 — tenantId stays out of the wire. Main process
  // reads it from the desktopSession singleton.
  getAll: (table: string) => ipcRenderer.invoke('db:getAll', table),
  getById: (table: string, id: string) => ipcRenderer.invoke('db:getById', table, id),
  insert: (table: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('db:insert', table, data),
  update: (table: string, id: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('db:update', table, id, data),
  delete: (table: string, id: string) => ipcRenderer.invoke('db:delete', table, id),
  getByField: (table: string, fieldName: string, value: unknown) =>
    ipcRenderer.invoke('db:getByField', table, fieldName, value),
  deleteByTenant: (table: string) => ipcRenderer.invoke('db:deleteByTenant', table),
  countByTenant: (table: string) => ipcRenderer.invoke('db:countByTenant', table),
  addToSyncQueue: (item: Record<string, unknown>) => ipcRenderer.invoke('db:addToSyncQueue', item),
  getPendingSyncItems: () => ipcRenderer.invoke('db:getPendingSyncItems'),
};

const syncAPI: SyncAPI = {
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  triggerSync: () => ipcRenderer.invoke('sync:triggerSync'),
  setConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('sync:setConfig', config),
};

const sessionAPI: SessionAPI = {
  register: (accessToken: string) => ipcRenderer.invoke('session:register', accessToken),
  clear: () => ipcRenderer.invoke('session:clear'),
};

const desktopBridgeAPI: DesktopBridgeAPI = {
  ...electronAPI,
  db: dbAPI,
  sync: syncAPI,
  session: sessionAPI,
};

// Expose APIs to renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('db', dbAPI);
contextBridge.exposeInMainWorld('sync', syncAPI);
contextBridge.exposeInMainWorld('session', sessionAPI);
contextBridge.exposeInMainWorld('api', desktopBridgeAPI);
