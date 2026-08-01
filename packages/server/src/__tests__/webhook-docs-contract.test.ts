import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_EVENTS_VERSION, PUBLIC_EVENT_TYPES } from '../services/events/manifest.js';

describe('webhook public documentation contract', () => {
  it('publishes the live manifest version, every event, signature, pagination, and retry policy', () => {
    const docs = readFileSync(resolve(process.cwd(), '../../docs/WEBHOOKS.md'), 'utf8');
    expect(docs).toContain(`Contract version: **${PUBLIC_EVENTS_VERSION}**`);
    for (const eventType of PUBLIC_EVENT_TYPES) expect(docs).toContain(`\`${eventType}\``);
    expect(docs).toContain('X-Puntovivo-Signature');
    expect(docs).toContain('Idempotency-Key');
    expect(docs).toContain('`limit` (1–200)');
    expect(docs).toContain('dead letter');
  });
});
