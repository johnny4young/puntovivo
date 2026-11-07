/**
 * The server instance owned by the thread this module runs on. Only code that
 * runs next to the server reads it; main-thread code uses the host contract.
 */
import type { PuntovivoServer } from '@puntovivo/server';

let hosted: PuntovivoServer | null = null;

export function setHostedServer(next: PuntovivoServer | null): void {
  hosted = next;
}

export function getHostedDatabase(): PuntovivoServer['db'] {
  if (!hosted) throw new Error('The embedded server is not available');
  return hosted.db;
}

export function getHostedSqlite(): import('better-sqlite3').Database {
  return (
    getHostedDatabase() as PuntovivoServer['db'] & { $client: import('better-sqlite3').Database }
  ).$client;
}
