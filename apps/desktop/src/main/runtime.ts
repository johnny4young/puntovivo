/**
 * main-process runtime hub for the embedded server handle.
 *
 * Holds the single mutable reference to the in-process Fastify server and
 * the safe accessors every `ipc/*` handler uses to reach the database.
 * Kept deliberately Electron-free (it imports only types from
 * `@puntovivo/server`) so the `ipc/db.ts` / `ipc/sync.ts` concern modules
 * that depend on it stay unit-testable under `node --test` without booting
 * Electron — mirroring the existing `backup-bundle.ts` / `desktopSession.ts`
 * Electron-free idiom.
 *
 * The server reference is a module-level singleton because the Electron
 * main process is single-threaded; bootstrap (`index.ts`) owns its
 * lifecycle and assigns it via {@link setServer}, while handlers read the
 * live value via {@link getServerDatabase} / {@link getSqliteClient} at
 * request time (always after boot).
 *
 * @module main/runtime
 */

import type { PuntovivoServer } from '@puntovivo/server';

let server: PuntovivoServer | null = null;

/** The live embedded-server reference, or null before boot / during restart. */
export function getServer(): PuntovivoServer | null {
  return server;
}

/** Bootstrap + server-restart assign the live reference here. */
export function setServer(next: PuntovivoServer | null): void {
  server = next;
}

export function getServerDatabase(): PuntovivoServer['db'] {
  if (!server) {
    throw new Error('The embedded server is not available');
  }

  return server.db;
}

export function getSqliteClient() {
  return getServerDatabase() as PuntovivoServer['db'] & {
    $client: import('better-sqlite3').Database;
  };
}

/** Resolved embedded-server URL, with the historical localhost fallback. */
export function getServerUrl(): string {
  return server?.getUrl() || 'http://127.0.0.1:8090';
}
