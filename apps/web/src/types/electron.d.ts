/**
 * Type declarations for Electron preload APIs
 * These APIs are exposed when the app runs inside Electron
 */

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
  printReceipt: (
    receiptHtml: string
  ) => Promise<{ success: boolean; error?: string }>;
  updateMainLocale?: (locale: string) => Promise<'en' | 'es'>;
  runtime?: RuntimeAPI;
  peripherals?: PeripheralsAPI;
}

export interface RendererRuntimeConfig {
  authorityMode: 'device_local' | 'site_hub' | 'hub_client';
  hubUrl: string | null;
  siteId: string | null;
  deviceId: string | null;
}

export interface RuntimeAPI {
  getConfigSync: () => RendererRuntimeConfig;
}

/**
 * ENG-074b — local hardware bridge for hub_client terminals. The
 * renderer fetches ESC/POS bytes from the hub via tRPC and pipes
 * them here so the Electron main process writes them to the
 * locally-attached printer / drawer. Per ADR-0008 rule 6 the bridge
 * NEVER touches operational tables.
 */
export interface LocalEscPosTransportHint {
  channel: 'usb' | 'tcp' | 'serial' | 'mock';
  host?: string | null;
  port?: number | null;
  vendorId?: number | null;
  productId?: number | null;
  devicePath?: string | null;
  timeoutMs?: number | null;
}

export interface PeripheralsAPI {
  dispatchLocalEscpos: (payload: {
    bytes: number[];
    transport: LocalEscPosTransportHint;
  }) => Promise<{ success: boolean; error?: string; errorCode?: string }>;
}

/**
 * ENG-025 vector 1 — tenantId is no longer a wire argument. Main
 * derives it from the registered desktopSession singleton.
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
 * ENG-025 vector 1 — desktop session lifecycle bound to the JWT
 * access token. Renderer registers the token after login and clears
 * on logout; main validates against the embedded server.
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

declare global {
  // ENG-179b — explicit `| undefined` on optional fields.
  interface Window {
    electron?: ElectronAPI | undefined;
    db?: DatabaseAPI | undefined;
    sync?: SyncAPI | undefined;
    session?: SessionAPI | undefined;
    api?: DesktopBridgeAPI | undefined;
  }
}

/**
 * Check if running inside Electron
 */
export function isElectron(): boolean {
  return typeof window !== 'undefined' && window.electron !== undefined;
}
