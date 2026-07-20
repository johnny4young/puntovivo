import { randomBytes } from 'node:crypto';

import type { SseEvent } from './contracts.js';

export function parseEventId(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveLastEventId(
  header: string | string[] | undefined,
  queryFallback: string | undefined
): string | null {
  return (Array.isArray(header) ? header[0] : header)?.trim() || queryFallback?.trim() || null;
}

/**
 * Format an SSE message according to the spec
 */
export function formatSseMessage(event: SseEvent): string {
  let message = '';

  if (event.id) {
    message += `id: ${event.id}\n`;
  }

  if (event.event) {
    message += `event: ${event.event}\n`;
  }

  if (event.retry) {
    message += `retry: ${event.retry}\n`;
  }

  const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);

  // Split data by newlines for proper SSE format
  const lines = dataStr.split('\n');
  for (const line of lines) {
    message += `data: ${line}\n`;
  }

  message += '\n';
  return message;
}

/**
 * Generate a unique client ID using crypto-strong entropy ().
 *
 * Replaces the legacy `Date.now()` + `Math.random()` recipe — both
 * components were predictable enough for an attacker who could guess a
 * recent connection to attempt channel hijack. `randomBytes(16)` yields
 * 128 bits of unguessable entropy, encoded as 32 hex chars.
 */
export function generateClientId(): string {
  return `sse_${randomBytes(16).toString('hex')}`;
}

export function getCorsHeaders(
  originHeader: string | undefined,
  allowedOrigins: readonly string[]
): Record<string, string> {
  if (!originHeader || !allowedOrigins.includes(originHeader)) {
    return {};
  }
  return {
    'Access-Control-Allow-Origin': originHeader,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}
