import { createSseParser, type ParsedSseEvent } from '@puntovivo/shared/realtime-sse';
import { getRuntimeConfigSync } from './runtimeConfigClient';
import { expireAuthSession, fetchProtectedApi } from './trpc';
import type { SessionAPI } from '@/types/electron';

export interface RealtimeConnectorInput {
  collections: string;
  lastEventId: string | null;
  signal: AbortSignal;
  onOpen: () => void;
  onEvent: (event: ParsedSseEvent) => void;
}

export type RealtimeConnector = (input: RealtimeConnectorInput) => Promise<void>;

export type ProtectedRealtimeFetch = (
  path: `/api/${string}`,
  init: RequestInit
) => Promise<Response>;

export class RealtimeHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Realtime subscription failed (${status})`);
    this.name = 'RealtimeHttpError';
    this.status = status;
  }
}

/** Authorization-capable browser/local-authority SSE transport. */
export function createFetchRealtimeConnector(
  protectedFetch: ProtectedRealtimeFetch = fetchProtectedApi
): RealtimeConnector {
  return async input => {
    const search = new URLSearchParams({ collections: input.collections });
    const headers = new Headers({ accept: 'text/event-stream' });
    if (input.lastEventId) headers.set('last-event-id', input.lastEventId);
    const response = await protectedFetch(`/api/realtime/subscribe?${search.toString()}`, {
      method: 'GET',
      headers,
      signal: input.signal,
    });
    if (!response.ok) throw new RealtimeHttpError(response.status);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error('Realtime response has an invalid content type');
    }
    if (!response.body) throw new Error('Realtime response is not streamable');

    input.onOpen();
    const parser = createSseParser(input.onEvent);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!input.signal.aborted) {
        const result = await reader.read();
        if (result.done) break;
        parser.push(decoder.decode(result.value, { stream: true }));
      }
      parser.push(decoder.decode());
    } finally {
      reader.releaseLock();
    }
  };
}

/** Fixed-channel Electron relay for a remote Store Hub stream. */
export function createHubRealtimeConnector(
  session: Pick<SessionAPI, 'openHubRealtime' | 'closeHubRealtime'>
): RealtimeConnector {
  return input =>
    new Promise<void>((resolve, reject) => {
      if (input.signal.aborted) {
        resolve();
        return;
      }
      let settled = false;
      let subscriptionId = '';
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener('abort', handleAbort);
        if (error) reject(error);
        else resolve();
      };
      const handleAbort = () => {
        if (subscriptionId) void session.closeHubRealtime(subscriptionId);
        finish();
      };
      input.signal.addEventListener('abort', handleAbort, { once: true });
      subscriptionId = session.openHubRealtime(
        {
          collections: input.collections,
          ...(input.lastEventId ? { lastEventId: input.lastEventId } : {}),
        },
        message => {
          if (message.kind === 'open') {
            input.onOpen();
            return;
          }
          if (message.kind === 'event') {
            input.onEvent(message.event);
            return;
          }
          if (message.kind === 'closed') {
            finish();
            return;
          }
          if (message.status === 401 || message.status === 403) expireAuthSession();
          finish(new RealtimeHttpError(message.status ?? 503));
        }
      );
    });
}

export const connectRealtime: RealtimeConnector = input => {
  if (getRuntimeConfigSync().authorityMode === 'hub_client') {
    const session = window.api?.session ?? window.session;
    if (!session?.openHubRealtime || !session.closeHubRealtime) {
      return Promise.reject(new Error('Store Hub realtime bridge is unavailable'));
    }
    return createHubRealtimeConnector(session)(input);
  }
  return createFetchRealtimeConnector()(input);
};
