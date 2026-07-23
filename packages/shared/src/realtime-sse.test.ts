import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSseParser, type ParsedSseEvent } from './realtime-sse.ts';

describe('realtime SSE parser', () => {
  it('parses named multiline events across arbitrary chunks', () => {
    const events: ParsedSseEvent[] = [];
    const parser = createSseParser(event => events.push(event));

    parser.push('id: 41\r\nevent: kds.order.');
    parser.push('updated\r\ndata: {"part":1}\r\ndata: tail\r\nretry: 5000\r\n\r\n');

    assert.deepEqual(events, [
      {
        event: 'kds.order.updated',
        data: '{"part":1}\ntail',
        id: '41',
        retry: 5000,
      },
    ]);
  });

  it('ignores comments, unknown fields, invalid retry values, and null ids', () => {
    const events: ParsedSseEvent[] = [];
    const parser = createSseParser(event => events.push(event));

    parser.push(': heartbeat\nunknown: value\nid: unsafe\0id\nretry: soon\ndata: ready\n\n');

    assert.deepEqual(events, [{ event: 'message', data: 'ready' }]);
  });

  it('does not dispatch an incomplete event and reset discards buffered state', () => {
    const events: ParsedSseEvent[] = [];
    const parser = createSseParser(event => events.push(event));

    parser.push('event: stale\ndata: unfinished');
    parser.reset();
    parser.push('data: current\n\n');

    assert.deepEqual(events, [{ event: 'message', data: 'current' }]);
  });
});
