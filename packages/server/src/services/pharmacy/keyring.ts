import { randomBytes, timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { pharmacyEvidenceKeys } from '../../db/schema.js';

const EVIDENCE_KEY_ID = 'evidence-v1';
const MINIMUM_SECRET_BYTES = 32;

function assertSecretStrength(value: string): void {
  if (value !== value.trim() || Buffer.byteLength(value, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error('PHARMACY_EVIDENCE_KEY_INVALID');
  }
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Resolve the database-local pharmacy data key. A configured key seeds a new
 * database but may never silently replace the persisted value: rotation needs
 * an explicit row-by-row re-encryption protocol.
 */
export function resolvePharmacyEvidenceKey(db: DatabaseInstance, configured?: string): string {
  const candidate = configured;
  if (candidate !== undefined) assertSecretStrength(candidate);

  return db.transaction(
    tx => {
      const existing = tx
        .select({ secretMaterial: pharmacyEvidenceKeys.secretMaterial })
        .from(pharmacyEvidenceKeys)
        .where(eq(pharmacyEvidenceKeys.id, EVIDENCE_KEY_ID))
        .get();
      if (existing) {
        assertSecretStrength(existing.secretMaterial);
        if (candidate && !equalSecret(existing.secretMaterial, candidate)) {
          throw new Error('PHARMACY_EVIDENCE_KEY_MISMATCH');
        }
        return existing.secretMaterial;
      }

      const secretMaterial = candidate ?? randomBytes(MINIMUM_SECRET_BYTES).toString('base64url');
      tx.insert(pharmacyEvidenceKeys).values({ id: EVIDENCE_KEY_ID, secretMaterial }).run();
      return secretMaterial;
    },
    { behavior: 'immediate' }
  );
}
