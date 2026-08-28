/**
 * Audit-chain anchor key and freshness state.
 *
 * The database head carries a keyed MAC, while an optional store outside the
 * database remembers the last confirmed `(counter, headHash)` plus one
 * crash-recoverable pending reservation. Desktop supplies a safeStorage-backed
 * store; standalone/tests may run with only the HMAC key and therefore keep
 * integrity anchoring without claiming rewind protection.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const AUDIT_ANCHOR_ENVELOPE_VERSION = 1 as const;

export interface AuditAnchorPoint {
  counter: number;
  headHash: string;
}

export interface AuditAnchorTenantEnvelope {
  version: typeof AUDIT_ANCHOR_ENVELOPE_VERSION;
  confirmed: AuditAnchorPoint;
  pending: AuditAnchorPoint | null;
}

/** Synchronous because audit rows are written inside better-sqlite3 transactions. */
export interface AuditAnchorStore {
  read(tenantId: string): AuditAnchorTenantEnvelope | null;
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

function assertPoint(point: AuditAnchorPoint): void {
  if (
    !Number.isSafeInteger(point.counter) ||
    point.counter < 0 ||
    (point.headHash !== 'genesis' && !/^[0-9a-f]{64}$/i.test(point.headHash))
  ) {
    throw new Error('AUDIT_ANCHOR_STATE_INVALID');
  }
}

function readEnvelope(tenantId: string): AuditAnchorTenantEnvelope | null {
  if (!anchorStore) return null;
  const envelope = anchorStore.read(tenantId);
  if (!envelope) return null;
  if (envelope.version !== AUDIT_ANCHOR_ENVELOPE_VERSION) {
    throw new Error('AUDIT_ANCHOR_STATE_VERSION_UNSUPPORTED');
  }
  assertPoint(envelope.confirmed);
  if (envelope.pending) {
    assertPoint(envelope.pending);
    if (envelope.pending.counter <= envelope.confirmed.counter) {
      throw new Error('AUDIT_ANCHOR_STATE_INVALID');
    }
  }
  return envelope;
}

function samePoint(a: AuditAnchorPoint, b: AuditAnchorPoint): boolean {
  return a.counter === b.counter && a.headHash === b.headHash;
}

/**
 * Reconcile the DB with the external envelope.
 *
 * `write` accepts a pending point visible through the current transaction but
 * deliberately does not confirm it: the surrounding transaction may still
 * roll back. `settle` runs only after the synchronous stack/commit boundary or
 * at explicit verification and promotes/discards pending accordingly.
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
      pending: null,
    });
    return { freshnessAnchored: true, pending: false };
  }

  if (envelope.pending && samePoint(databasePoint, envelope.pending)) {
    if (mode === 'settle') {
      anchorStore.write(tenantId, {
        version: AUDIT_ANCHOR_ENVELOPE_VERSION,
        confirmed: envelope.pending,
        pending: null,
      });
      return { freshnessAnchored: true, pending: false };
    }
    return { freshnessAnchored: true, pending: true };
  }

  if (samePoint(databasePoint, envelope.confirmed)) {
    if (envelope.pending) {
      // Reservation happened but the DB transaction never committed.
      anchorStore.write(tenantId, { ...envelope, pending: null });
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
  const baseMatches = samePoint(databasePoint, envelope.pending ?? envelope.confirmed);
  if (!baseMatches) throw new Error('AUDIT_ANCHOR_DIVERGENCE');
  anchorStore.write(tenantId, { ...envelope, pending: nextPoint });
}

/** Trusted restore/adoption boundary. Never call during ordinary writes. */
export function adoptAuditAnchorPoint(tenantId: string, point: AuditAnchorPoint): void {
  if (!anchorStore) return;
  assertPoint(point);
  anchorStore.write(tenantId, {
    version: AUDIT_ANCHOR_ENVELOPE_VERSION,
    confirmed: point,
    pending: null,
  });
}
