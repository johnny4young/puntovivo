import { useSyncExternalStore } from 'react';
import type { EmbeddedServerState } from '@/types/electron';

let current: EmbeddedServerState = 'running';
let pushed = false;
let subscribed = false;
const listeners = new Set<() => void>();

function publish(next: EmbeddedServerState): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function ensureSubscribed(): void {
  if (subscribed || typeof window === 'undefined') return;
  const api = window.electron;
  if (!api?.onServerStateChange) return;
  subscribed = true;
  api.onServerStateChange(next => {
    pushed = true;
    publish(next);
  });
  void api
    .getServerState?.()
    .then(state => {
      // A push that arrived first is newer than this snapshot.
      if (!pushed) publish(state);
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The desktop embedded server's state; always `running` in the web build. */
export function useEmbeddedServerState(): EmbeddedServerState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'running'
  );
}

/** Test-only reset of the module store. */
export function __resetEmbeddedServerStateForTests(): void {
  current = 'running';
  pushed = false;
  subscribed = false;
  listeners.clear();
}
