/**
 * ENG-178 — stable contracts injected into the desktop backup IPC flows.
 *
 * @module main/ipc/backup/contracts
 */

import type { BrowserWindow } from 'electron';

export interface DesktopDatabaseActionResult {
  success: boolean;
  cancelled: boolean;
  path?: string;
  /**
   * ENG-066 — bytes of the produced backup ZIP. Existing renderer callers
   * can ignore it; future toasts/diagnostics may surface it.
   */
  sizeBytes?: number;
  error?: string;
  /**
   * ENG-167b — the selected bundle is encrypted with a DIFFERENT
   * device's key. The staging copy is held server-side under `token`;
   * the renderer prompts the operator for the source device's backup
   * key and completes the restore via `provideRestoreKey(token, key)`.
   */
  needsKey?: boolean;
  token?: string;
}

export interface BackupIpcDeps {
  /** Absolute path of the live encrypted SQLite database. */
  dbPath: string;
  /** Live main window (or null) — parents the native save/open dialogs. */
  getMainWindow: () => BrowserWindow | null;
  /**
   * ENG-167 — resolves (and caches) this install's SQLCipher key from the
   * safeStorage envelope; owned by index.ts because the embedded-server
   * boot shares the same cache.
   */
  resolveDatabaseEncryptionKey: () => Promise<string>;
  /**
   * Stops the embedded server, runs `operation`, then restarts the server
   * (optionally reloading the renderer). Owned by index.ts because it
   * drives the server lifecycle.
   */
  runWithServerRestart: <T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ) => Promise<T>;
}
