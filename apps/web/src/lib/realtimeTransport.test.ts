import { describe, expect, it, vi } from 'vitest';
import {
  createFetchRealtimeConnector,
  createHubRealtimeConnector,
  RealtimeHttpError,
  type ProtectedRealtimeFetch,
} from './realtimeTransport';
import { setAuthSessionExpiredHandler } from './trpc';
import type { HubRealtimeMessage, SessionAPI } from '@/types/electron';

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } }
  );
}

describe('realtime transport', () => {
  it('streams framed events through Authorization-capable protected fetch', async () => {
    const events: Array<{ event: string; data: string; id?: string }> = [];
    let capturedPath = '';
    let capturedInit: RequestInit = {};
    const protectedFetch: ProtectedRealtimeFetch = async (path, init) => {
      capturedPath = path;
      capturedInit = init;
      return streamResponse(['event: kds.order.', 'created\nid: 9\ndata: {"ok":true}\n\n']);
    };
    const onOpen = vi.fn();
    await createFetchRealtimeConnector(protectedFetch)({
      collections: 'kds',
      lastEventId: '8',
      signal: new AbortController().signal,
      onOpen,
      onEvent: event => events.push(event),
    });

    expect(capturedPath).toBe('/api/realtime/subscribe?collections=kds');
    expect(capturedInit).toEqual(
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    const headers = new Headers(capturedInit.headers);
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.get('last-event-id')).toBe('8');
    expect(onOpen).toHaveBeenCalledOnce();
    expect(events).toEqual([{ event: 'kds.order.created', data: '{"ok":true}', id: '9' }]);
  });

  it('rejects non-success responses before declaring the stream open', async () => {
    const onOpen = vi.fn();
    await expect(
      createFetchRealtimeConnector(async () => new Response('', { status: 403 }))({
        collections: 'kds',
        lastEventId: null,
        signal: new AbortController().signal,
        onOpen,
        onEvent: () => {},
      })
    ).rejects.toEqual(expect.objectContaining({ status: 403 }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('rejects a successful response that is not an SSE stream', async () => {
    await expect(
      createFetchRealtimeConnector(() =>
        Promise.resolve(
          new Response('{"ok":true}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        )
      )({
        collections: 'kds',
        lastEventId: null,
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: () => {},
      })
    ).rejects.toThrow(/invalid content type/);
  });

  it('relays Store Hub events and closes the narrow IPC subscription on abort', async () => {
    let listener: (message: HubRealtimeMessage) => void = () => {
      throw new Error('Expected Store Hub listener to be installed');
    };
    const closeHubRealtime = vi.fn(async () => ({ ok: true }));
    const session: Pick<SessionAPI, 'openHubRealtime' | 'closeHubRealtime'> = {
      openHubRealtime: (_input, next) => {
        listener = next;
        return 'subscription-1';
      },
      closeHubRealtime,
    };
    const controller = new AbortController();
    const onOpen = vi.fn();
    const onEvent = vi.fn();
    const running = createHubRealtimeConnector(session)({
      collections: 'kds',
      lastEventId: '4',
      signal: controller.signal,
      onOpen,
      onEvent,
    });

    listener({ kind: 'open' });
    listener({
      kind: 'event',
      event: { event: 'kds.order.updated', data: '{}', id: '5' },
    });
    controller.abort();
    await running;

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({ event: 'kds.order.updated', data: '{}', id: '5' });
    expect(closeHubRealtime).toHaveBeenCalledWith('subscription-1');
  });

  it('expires the renderer session when Store Hub rejects the stream', async () => {
    const expired = vi.fn();
    setAuthSessionExpiredHandler(expired);
    const session: Pick<SessionAPI, 'openHubRealtime' | 'closeHubRealtime'> = {
      openHubRealtime: (_input, listener) => {
        queueMicrotask(() => listener({ kind: 'error', message: 'revoked', status: 401 }));
        return 'subscription-2';
      },
      closeHubRealtime: vi.fn(async () => ({ ok: true })),
    };

    await expect(
      createHubRealtimeConnector(session)({
        collections: 'kds',
        lastEventId: null,
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: () => {},
      })
    ).rejects.toBeInstanceOf(RealtimeHttpError);
    expect(expired).toHaveBeenCalledOnce();
    setAuthSessionExpiredHandler(null);
  });
});
