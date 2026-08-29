/**
 * Audit-chain anchor key and freshness state.
 *
 * The database head carries a keyed MAC, while an optional store outside the
 * database remembers the last confirmed `(counter, headHash)` plus the ordered
 * crash-recoverable reservations that have not crossed a confirmed transaction
 * boundary yet. Desktop supplies a safeStorage-backed store; standalone/tests
 * may run with only the HMAC key and therefore keep integrity anchoring without
 * claiming rewind protection.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const LEGACY_AUDIT_ANCHOR_ENVELOPE_VERSION = 1 as const;
export const AUDIT_ANCHOR_ENVELOPE_VERSION = 2 as const;

export interface AuditAnchorPoint {
  counter: number;
  headHash: string;
}

export interface AuditAnchorTenantEnvelope {
  version: typeof AUDIT_ANCHOR_ENVELOPE_VERSION;
  confirmed: AuditAnchorPoint;
  pending: AuditAnchorPoint[];
}

export interface LegacyAuditAnchorTenantEnvelope {
  version: typeof LEGACY_AUDIT_ANCHOR_ENVELOPE_VERSION;
  confirmed: AuditAnchorPoint;
  pending: AuditAnchorPoint | null;
}

export type AuditAnchorStoredTenantEnvelope =
  AuditAnchorTenantEnvelope | LegacyAuditAnchorTenantEnvelope;

/** Synchronous because audit rows are written inside better-sqlite3 transactions. */
export interface AuditAnchorStore {
  read(tenantId: string): AuditAnchorStoredTenantEnvelope | null;
  write(tenantId: string, envelope: AuditAnchorTenantEnvelope): void;
}

let anchorKey: Buffer | null = null;
let anchorStore: AuditAnchorStore | null = null;

function deriveAuditAnchorKey(source: string): Buffer {
  return createHash('sha256').update('puntovivo:audit-anchor:v1').update(source).digest();
}

export function configureAuditAnchor(options: {
  source?: string | undefined;
  store?: AuditAnchorStore | undefined;
}): void {
  if (options.store && !options.source) {
    throw new Error('AUDIT_ANCHOR_KEY_REQUIRED');
  }
  anchorKey = options.source ? deriveAuditAnchorKey(options.source) : null;
  anchorStore = options.store ?? null;
}

/** Compatibility boundary for unpersisted standalone/tests. */
export function configureAuditAnchorKey(source: string | undefined): void {
  configureAuditAnchor({ source });
}

export function hasAuditAnchorKey(): boolean {
  return anchorKey !== null;
}

export function hasAuditAnchorStore(): boolean {
  return anchorStore !== null;
}

function canonicalMacPayload(tenantId: string, headHash: string, counter: number): string {
  return `audit-head-v2\n${tenantId}\n${counter}\n${headHash}`;
}

function legacyMacPayload(tenantId: string, headHash: string): string {
  return `${tenantId}\n${headHash}`;
}

function computeWithKey(key: Buffer, tenantId: string, headHash: string, counter: number): string {
  return createHmac('sha256', key)
    .update(canonicalMacPayload(tenantId, headHash, counter))
    .digest('hex');
}

export function computeAuditHeadMac(
  tenantId: string,
  headHash: string,
  counter = 0
): string | null {
  if (!anchorKey) return null;
  return computeWithKey(anchorKey, tenantId, headHash, counter);
}

/** Pure boundary for trusted cross-install restore tooling. */
export function computeAuditHeadMacForSource(
  source: string,
  tenantId: string,
  headHash: string,
  counter = 0
): string {
  return computeWithKey(deriveAuditAnchorKey(source), tenantId, headHash, counter);
}

function equalsHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyAuditHeadMac(
  tenantId: string,
  headHash: string,
  counter: number,
  mac: string
): boolean {
  if (!anchorKey) return false;
  if (equalsHex(computeWithKey(anchorKey, tenantId, headHash, counter), mac)) return true;

  // Migration 0048 initializes old heads at counter zero. Accept their v1
  // stamp only at that exact boundary; the next legitimate write advances to
  // counter one and permanently uses the counter-bound v2 payload.
  if (counter !== 0) return false;
  const legacy = createHmac('sha256', anchorKey)
    .update(legacyMacPayload(tenantId, headHash))
    .digest('hex');
  return equalsHex(legacy, mac);
}

function assertPoint(point: unknown): asserts point is AuditAnchorPoint {
  const record = point as Record<string, unknown> | null;
  if (
    record === null ||
    typeof record !== 'object' ||
    typeof record.counter !== 'number' ||
    !Number.isSafeInteger(record.counter) ||
    record.counter < 0 ||
    typeof record.headHash !== 'string' ||
    (record.headHash !== 'genesis' && !/^[0-9a-f]{64}$/i.test(record.headHash))
  ) {
    throw new Error('AUDIT_ANCHOR_STATE_INVALID');
  }
}

function normalizeEnvelope(stored: AuditAnchorStoredTenantEnvelope): AuditAnchorTenantEnvelope {
  if (
    typeof stored !== 'object' ||
    stored === null ||
    !('version' in stored) ||
    !('confirmed' in stored) ||
    !('pending' in stored)
  ) {
    throw new Error('AUDIT_ANCHOR_STATE_INVALID');
  }
  if (
    stored.version !== LEGACY_AUDIT_ANCHOR_ENVELOPE_VERSION &&
    stored.version !== AUDIT_ANCHOR_ENVELOPE_VERSION
  ) {
    throw new Error('AUDIT_ANCHOR_STATE_VERSION_UNSUPPORTED');
  }

  assertPoint(stored.confirmed);
  const pending =
    stored.version === LEGACY_AUDIT_ANCHOR_ENVELOPE_VERSION
      ? stored.pending === null
        ? []
        : [stored.pending]
      : stored.pending;
  if (!Array.isArray(pending)) throw new Error('AUDIT_ANCHOR_STATE_INVALID');

  let previous = stored.confirmed;
  for (const point of pending) {
    assertPoint(point);
    if (point.counter !== previous.counter + 1) {
      throw new Error('AUDIT_ANCHOR_STATE_INVALID');
    }
    previous = point;
  }
  return {
    version: AUDIT_ANCHOR_ENVELOPE_VERSION,
    confirmed: stored.confirmed,
    pending: [...pending],
  };
}

function readEnvelope(tenantId: string): AuditAnchorTenantEnvelope | null {
  if (!anchorStore) return null;
  const stored = anchorStore.read(tenantId);
  return stored ? normalizeEnvelope(stored) : null;
}

function samePoint(a: AuditAnchorPoint, b: AuditAnchorPoint): boolean {
  return a.counter === b.counter && a.headHash === b.headHash;
}

/**
 * Reconcile the DB with the external envelope.
 *
 * `write` accepts pending points visible through the current transaction but
 * deliberately does not confirm them: the surrounding transaction may still
 * roll back. `settle` runs only after the synchronous stack/commit boundary or
 * at explicit verification and promotes/discards the ordered candidates
 * according to the actual database head.
 */
export function reconcileAuditAnchor(
  tenantId: string,
  databasePoint: AuditAnchorPoint,
  mode: 'write' | 'settle'
): { freshnessAnchored: boolean; pending: boolean } {
  if (!anchorStore) return { freshnessAnchored: false, pending: false };
  const envelope = readEnvelope(tenantId);
  if (!envelope) {
    // Counter zero is the explicit adoption boundary (migration 0048 or a
    // tenant with no head yet). Once the database advanced, disappearance of
    // external state is tampering/corruption, never a reason to bless it.
    if (databasePoint.counter !== 0) {
      throw new Error('AUDIT_ANCHOR_STATE_MISSING');
    }
    anchorStore.write(tenantId, {
      version: AUDIT_ANCHOR_ENVELOPE_VERSION,
      confirmed: databasePoint,
      pending: [],
    });
    return { freshnessAnchored: true, pending: false };
  }

  const pendingIndex = envelope.pending.findIndex(point => samePoint(databasePoint, point));
  if (pendingIndex !== -1) {
    if (mode === 'settle') {
      anchorStore.write(tenantId, {
        version: AUDIT_ANCHOR_ENVELOPE_VERSION,
        confirmed: databasePoint,
        pending: [],
      });
      return { freshnessAnchored: true, pending: false };
    }
    if (pendingIndex !== envelope.pending.length - 1) {
      // Later candidates came from a transaction that rolled back. Preserve
      // the matched committed/in-transaction prefix before accepting a retry.
      anchorStore.write(tenantId, {
        ...envelope,
        pending: envelope.pending.slice(0, pendingIndex + 1),
      });
    }
    return { freshnessAnchored: true, pending: true };
  }

  if (samePoint(databasePoint, envelope.confirmed)) {
    if (envelope.pending.length > 0) {
      // Every reservation happened inside a transaction that never committed.
      anchorStore.write(tenantId, { ...envelope, pending: [] });
    }
    return { freshnessAnchored: true, pending: false };
  }

  throw new Error('AUDIT_ANCHOR_DIVERGENCE');
}

export function reserveAuditAnchor(
  tenantId: string,
  databasePoint: AuditAnchorPoint,
  nextPoint: AuditAnchorPoint
): void {
  if (!anchorStore) return;
  if (nextPoint.counter !== databasePoint.counter + 1) {
    throw new Error('AUDIT_ANCHOR_COUNTER_INVALID');
  }
  reconcileAuditAnchor(tenantId, databasePoint, 'write');
  const envelope = readEnvelope(tenantId);
  if (!envelope) throw new Error('AUDIT_ANCHOR_STATE_MISSING');
  const baseMatches = samePoint(databasePoint, envelope.pending.at(-1) ?? envelope.confirmed);
  if (!baseMatches) throw new Error('AUDIT_ANCHOR_DIVERGENCE');
  anchorStore.write(tenantId, { ...envelope, pending: [...envelope.pending, nextPoint] });
}

/** Trusted restore/adoption boundary. Never call during ordinary writes. */
export function adoptAuditAnchorPoint(tenantId: string, point: AuditAnchorPoint): void {
  if (!anchorStore) return;
  assertPoint(point);
  anchorStore.write(tenantId, {
    version: AUDIT_ANCHOR_ENVELOPE_VERSION,
    confirmed: point,
    pending: [],
  });
}
