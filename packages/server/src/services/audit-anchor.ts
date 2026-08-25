/**
 * Audit chain anchor key.
 *
 * The audit hash chain (services/audit-logs.ts) is unkeyed SHA-256:
 * it detects naive tampering, but an adversary with full DB write
 * access can recompute every hash plus the stored head and stay
 * undetected. The anchor closes that gap for the head: each head
 * upsert stamps HMAC-SHA256(anchorKey, tenantId + newline + headHash)
 * into audit_chain_heads.head_mac, and the verifier recomputes it.
 * The key derives from material that never lives inside the DB — the
 * desktop's keychain-sealed SQLCipher key or a standalone env secret —
 * so forging the anchor requires compromising the key envelope, not
 * just the database file.
 *
 * Mirrors the webhook secret-box holder: configured once by
 * create-server, cleared on close, null when the deployment runs
 * unkeyed (tests, unkeyed dev DBs) in which case heads simply carry
 * no MAC and verification reports anchored: false.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

let anchorKey: Buffer | null = null;

function deriveAuditAnchorKey(source: string): Buffer {
  return createHash('sha256').update('puntovivo:audit-anchor:v1').update(source).digest();
}

export function configureAuditAnchorKey(source: string | undefined): void {
  anchorKey = source ? deriveAuditAnchorKey(source) : null;
}

export function hasAuditAnchorKey(): boolean {
  return anchorKey !== null;
}

export function computeAuditHeadMac(tenantId: string, headHash: string): string | null {
  if (!anchorKey) return null;
  return createHmac('sha256', anchorKey).update(`${tenantId}\n${headHash}`).digest('hex');
}

/** Pure boundary for trusted cross-install restore tooling. */
export function computeAuditHeadMacForSource(
  source: string,
  tenantId: string,
  headHash: string
): string {
  return createHmac('sha256', deriveAuditAnchorKey(source))
    .update(`${tenantId}\n${headHash}`)
    .digest('hex');
}

export function verifyAuditHeadMac(tenantId: string, headHash: string, mac: string): boolean {
  const expected = computeAuditHeadMac(tenantId, headHash);
  if (expected === null) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(mac, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
