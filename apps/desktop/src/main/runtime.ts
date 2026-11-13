/**
 * Main-process handle to the embedded server.
 *
 * Electron-free so IPC concern modules stay testable under `node --test`.
 * Bootstrap (`index.ts`) assigns the handle after start and around restarts;
 * handlers read it at request time through the host contract only.
 *
 * @module main/runtime
 */

import type { EmbeddedServerHost } from './server-host/contract.ts';

let host: EmbeddedServerHost | null = null;
let markReady!: () => void;
const serverReady = new Promise<void>(resolve => {
  markReady = resolve;
});

/** Resolves once boot has started the embedded server; later restarts do not reset it. */
export function whenServerReady(): Promise<void> {
  return serverReady;
}

export function markServerReady(): void {
  markReady();
}

/** The live host, or null before boot and during a restart. */
export function getServerHost(): EmbeddedServerHost | null {
  return host;
}

const hostWaiters = new Set<(next: EmbeddedServerHost) => void>();

/** Bootstrap and server restarts assign the live host here. */
export function setServerHost(next: EmbeddedServerHost | null): void {
  host = next;
  if (!next) return;
  for (const resolve of hostWaiters) resolve(next);
  hostWaiters.clear();
}

/** The live host, waiting through a worker restart before giving up. */
export function awaitServerHost(timeoutMs = 20_000): Promise<EmbeddedServerHost> {
  if (host) return Promise.resolve(host);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostWaiters.delete(onHost);
      reject(new Error('The embedded server is not available'));
    }, timeoutMs);
    timer.unref?.();
    const onHost = (next: EmbeddedServerHost) => {
      clearTimeout(timer);
      resolve(next);
    };
    hostWaiters.add(onHost);
  });
}

/**
 * Runs a read against the live host and, when the worker died under it,
 * once more against the next worker. Never use it for writes.
 */
export async function readThroughRestart<T>(
  read: (host: EmbeddedServerHost) => Promise<T>
): Promise<T> {
  const first = await awaitServerHost();
  try {
    return await read(first);
  } catch (error) {
    if (getServerHost() === first) throw error;
    return read(await awaitServerHost());
  }
}

/** The live host for handlers that cannot run without it. */
export function requireServerHost(): EmbeddedServerHost {
  if (!host) {
    throw new Error('The embedded server is not available');
  }
  return host;
}

/** Resolved embedded-server URL, with the historical localhost fallback. */
export function getServerUrl(): string {
  return host?.url || 'http://127.0.0.1:8090';
}
