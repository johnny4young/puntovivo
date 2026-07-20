import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { getSyncQueueIssueMessage, normalizeSyncLastError } from './companySyncDisplay';

/**
 * `lastError` arrives as one of two shapes after the
 * sync_queue → sync_outbox cutover:
 * - a plain string from the legacy IndexedDB offline buffer, OR
 * - a `NormalizedOutboxError` JSON object `{ kind, message? }`
 * from the server's `sync_outbox` rows (the kernel only
 * guarantees `kind`; `message` is best-effort).
 *
 * `normalizeSyncLastError` and `getSyncQueueIssueMessage` are the
 * two consumer-facing helpers. These tests pin both shapes plus
 * the missing-message fallback that surfaced during review.
 */

const tStub = ((key: string) => key) as unknown as TFunction;

describe('normalizeSyncLastError', () => {
  it('returns null when lastError is undefined', () => {
    expect(normalizeSyncLastError(undefined)).toBeNull();
  });

  it('returns null when lastError is null', () => {
    expect(normalizeSyncLastError(null)).toBeNull();
  });

  it('returns the plain string for legacy offline-buffer shape', () => {
    expect(normalizeSyncLastError('Remote endpoint unavailable')).toBe(
      'Remote endpoint unavailable'
    );
  });

  it('extracts the message field from NormalizedOutboxError objects', () => {
    expect(normalizeSyncLastError({ kind: 'NETWORK_TIMEOUT', message: 'connection reset' })).toBe(
      'connection reset'
    );
  });

  it('falls back to kind when the message field is missing', () => {
    expect(normalizeSyncLastError({ kind: 'NETWORK_TIMEOUT' })).toBe('NETWORK_TIMEOUT');
  });

  it('returns null when both message and kind are missing', () => {
    expect(normalizeSyncLastError({ attempts: 3 })).toBeNull();
  });

  it('returns null when message and kind are not strings', () => {
    expect(
      normalizeSyncLastError({ kind: 42 as unknown as string, message: { wrapped: true } })
    ).toBeNull();
  });
});

describe('getSyncQueueIssueMessage', () => {
  it('returns null when lastError is absent', () => {
    expect(getSyncQueueIssueMessage(tStub, null)).toBeNull();
    expect(getSyncQueueIssueMessage(tStub, undefined)).toBeNull();
  });

  it('routes string-shape "local record is missing" to the localized key', () => {
    expect(
      getSyncQueueIssueMessage(
        tStub,
        'Unable to sync products:abc because the local record is missing'
      )
    ).toBe('company.sync.queue.errorLocalMissing');
  });

  it('routes string-shape "pending conflict blocks" to the localized key', () => {
    expect(getSyncQueueIssueMessage(tStub, 'Pending conflict blocks products:abc')).toBe(
      'company.sync.queue.errorConflictBlocked'
    );
  });

  it('routes JSON-shape errors through the same matcher via the message field', () => {
    expect(
      getSyncQueueIssueMessage(tStub, {
        kind: 'CONFLICT',
        message: 'Pending conflict blocks products:abc',
      })
    ).toBe('company.sync.queue.errorConflictBlocked');
  });

  it('returns the generic key for unrecognized strings', () => {
    expect(getSyncQueueIssueMessage(tStub, 'something the matcher does not know')).toBe(
      'company.sync.queue.errorGeneric'
    );
  });

  it('returns the generic key when only kind is provided (kind-only fallback path)', () => {
    expect(getSyncQueueIssueMessage(tStub, { kind: 'NETWORK_TIMEOUT' })).toBe(
      'company.sync.queue.errorGeneric'
    );
  });

  it('returns null when both message and kind are missing', () => {
    expect(getSyncQueueIssueMessage(tStub, { attempts: 3 })).toBeNull();
  });
});
