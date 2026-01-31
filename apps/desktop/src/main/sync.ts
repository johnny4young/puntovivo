import { ipcMain, net } from 'electron';
import { getDatabase } from './database';

interface SyncConfig {
  apiUrl: string;
  syncInterval: number; // in milliseconds
  enabled: boolean;
}

let syncConfig: SyncConfig = {
  apiUrl: process.env.VITE_API_URL || 'http://localhost:8090',
  syncInterval: 30000, // 30 seconds
  enabled: true,
};

let syncIntervalId: NodeJS.Timeout | null = null;

export function setupSyncService(): void {
  // Setup IPC handlers
  ipcMain.handle('sync:getStatus', () => ({
    isOnline: net.isOnline(),
    lastSync: getLastSyncTime(),
    pendingItems: getPendingItemsCount(),
  }));

  ipcMain.handle('sync:triggerSync', async () => {
    return await performSync();
  });

  ipcMain.handle('sync:setConfig', (_event, config: Partial<SyncConfig>) => {
    syncConfig = { ...syncConfig, ...config };
    restartSyncInterval();
  });

  // Start automatic sync
  startSyncInterval();

  // Listen for online/offline events
  if (net.isOnline()) {
    console.log('Network is online, sync service ready');
  }
}

function startSyncInterval(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  if (syncConfig.enabled) {
    syncIntervalId = setInterval(async () => {
      if (net.isOnline()) {
        await performSync();
      }
    }, syncConfig.syncInterval);
  }
}

function restartSyncInterval(): void {
  startSyncInterval();
}

async function performSync(): Promise<{ success: boolean; synced: number; errors: string[] }> {
  const db = getDatabase();
  if (!db || !net.isOnline()) {
    return { success: false, synced: 0, errors: ['Database not available or offline'] };
  }

  const errors: string[] = [];
  let synced = 0;

  try {
    // Get pending sync items
    const pendingItems = db
      .prepare(
        `
      SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT 100
    `
      )
      .all() as Array<{
      id: string;
      entity_type: string;
      entity_id: string;
      operation: string;
      payload: string;
      tenant_id: string;
      retry_count: number;
    }>;

    for (const item of pendingItems) {
      try {
        // In a real implementation, this would make API calls
        // For now, we'll simulate the sync
        await simulateSyncItem(item);

        // Remove from queue on success
        db.prepare('DELETE FROM sync_queue WHERE id = ?').run(item.id);
        synced++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to sync ${item.entity_type}/${item.entity_id}: ${errorMessage}`);

        // Update retry count
        db.prepare(
          `
          UPDATE sync_queue
          SET retry_count = retry_count + 1, last_error = ?
          WHERE id = ?
        `
        ).run(errorMessage, item.id);
      }
    }

    // Update last sync time
    updateLastSyncTime();

    return { success: errors.length === 0, synced, errors };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, synced, errors: [errorMessage] };
  }
}

async function simulateSyncItem(item: { operation: string }): Promise<void> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Simulate occasional failures for testing
  if (Math.random() < 0.05) {
    throw new Error('Simulated network error');
  }
}

function getLastSyncTime(): string | null {
  const db = getDatabase();
  if (!db) return null;

  try {
    const result = db
      .prepare(
        `
      SELECT value FROM app_settings WHERE key = 'last_sync_time'
    `
      )
      .get() as { value: string } | undefined;
    return result?.value || null;
  } catch {
    // Table might not exist yet
    return null;
  }
}

function updateLastSyncTime(): void {
  const db = getDatabase();
  if (!db) return;

  try {
    // Create settings table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    db.prepare(
      `
      INSERT OR REPLACE INTO app_settings (key, value)
      VALUES ('last_sync_time', ?)
    `
    ).run(new Date().toISOString());
  } catch (error) {
    console.error('Failed to update last sync time:', error);
  }
}

function getPendingItemsCount(): number {
  const db = getDatabase();
  if (!db) return 0;

  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM sync_queue').get() as {
      count: number;
    };
    return result.count;
  } catch {
    return 0;
  }
}
