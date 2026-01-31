import { ElectronAPI } from '@electron-toolkit/preload';

interface DatabaseAPI {
  getAll: (table: string, tenantId: string) => Promise<unknown[]>;
  getById: (table: string, id: string) => Promise<unknown>;
  insert: (table: string, data: Record<string, unknown>) => Promise<unknown>;
  update: (table: string, id: string, data: Record<string, unknown>) => Promise<unknown>;
  delete: (table: string, id: string) => Promise<unknown>;
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
  addToSyncQueue: (item: Record<string, unknown>) => Promise<unknown>;
  getPendingSyncItems: (tenantId: string) => Promise<unknown[]>;
}

interface SyncAPI {
  getStatus: () => Promise<{
    isOnline: boolean;
    lastSync: string | null;
    pendingItems: number;
  }>;
  triggerSync: () => Promise<{
    success: boolean;
    synced: number;
    errors: string[];
  }>;
  setConfig: (config: Record<string, unknown>) => Promise<void>;
}

interface CustomAPI {
  getAppVersion: () => Promise<string>;
  getAppPath: () => Promise<string>;
  db: DatabaseAPI;
  sync: SyncAPI;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: CustomAPI;
  }
}
