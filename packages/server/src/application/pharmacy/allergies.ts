import { and, asc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { customers, pharmacyCustomerAllergies } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { pharmacyEquivalenceKey } from './generic-alternatives.js';
import type {
  AddPharmacyCustomerAllergyInput,
  ListPharmacyCustomerAllergiesInput,
  RemovePharmacyCustomerAllergyInput,
} from '../../trpc/schemas/pharmacy.js';

const PHARMACY_SALT_MODIFIERS = new Set([
  'sodico',
  'sodica',
  'potasico',
  'potasica',
  'calcico',
  'calcica',
  'magnesico',
  'magnesica',
  'trihidrato',
  'dihidrato',
  'monohidrato',
  'hemihidrato',
  'anhidro',
  'anhidra',
  'clorhidrato',
  'hidrocloruro',
  'hcl',
  'bromhidrato',
  'maleato',
  'tartrato',
  'succinato',
  'besilato',
  'mesilato',
  'fosfato',
  'acetato',
  'citrato',
  'fumarato',
  'valerato',
  'propionato',
  'dipropionato',
  'de',
  'del',
]);

function extractIngredientBaseTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const clean = value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US');
  const words = clean.split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const base = words.filter(w => !PHARMACY_SALT_MODIFIERS.has(w));
  return base.length > 0 ? base : words;
}

/**
 * Symmetric salt-aware active-ingredient matcher: matches exact normalized keys
 * or shared base INN component tokens (e.g. "Amoxicilina trihidrato" <-> "Amoxicilina",
 * "Diclofenaco sódico" <-> "Diclofenaco potásico") without substring false-positives
 * like "Sulfa" matching "Sulfato ferroso".
 */
export function matchesAllergyIngredient(
  medicineIngredient: string | null | undefined,
  allergyIngredient: string,
  allergyNormalized: string
): boolean {
  const medKey = pharmacyEquivalenceKey(medicineIngredient);
  if (!medKey) return false;
  if (medKey === allergyNormalized) return true;
  const medTokens = extractIngredientBaseTokens(medicineIngredient);
  const allergyTokens = extractIngredientBaseTokens(allergyIngredient);
  if (medTokens.length === 0 || allergyTokens.length === 0) return false;
  const medBasePhrase = medTokens.join(' ');
  const allergyBasePhrase = allergyTokens.join(' ');
  if (medBasePhrase === allergyBasePhrase) return true;
  // Combo products ("Amoxicilina + Ácido clavulánico"): match when every base token of the allergy appears as a whole token
  if (allergyTokens.every(tok => tok.length >= 4 && medTokens.includes(tok))) return true;
  return false;
}

export function listPharmacyCustomerAllergies(
  db: DatabaseInstance,
  tenantId: string,
  input: ListPharmacyCustomerAllergiesInput
) {
  const customer = db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, input.customerId),
        eq(customers.tenantId, tenantId),
        eq(customers.privacyStatus, 'active')
      )
    )
    .get();
  if (!customer) {
    return { items: [] };
  }

  const items = db
    .select({
      id: pharmacyCustomerAllergies.id,
      customerId: pharmacyCustomerAllergies.customerId,
      activeIngredient: pharmacyCustomerAllergies.activeIngredient,
      severity: pharmacyCustomerAllergies.severity,
      notes: pharmacyCustomerAllergies.notes,
      createdAt: pharmacyCustomerAllergies.createdAt,
    })
    .from(pharmacyCustomerAllergies)
    .where(
      and(
        eq(pharmacyCustomerAllergies.tenantId, tenantId),
        eq(pharmacyCustomerAllergies.customerId, input.customerId)
      )
    )
    .orderBy(asc(pharmacyCustomerAllergies.activeIngredient))
    .all();

  return { items };
}

export function addPharmacyCustomerAllergy(
  db: DatabaseInstance,
  ctx: { tenantId: string; actorId: string },
  input: AddPharmacyCustomerAllergyInput
) {
  const normalized = pharmacyEquivalenceKey(input.activeIngredient);
  if (!normalized) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_ALLERGY_NOT_FOUND',
      message: 'Active ingredient is required',
    });
  }

  const now = new Date().toISOString();
  const id = nanoid();

  return db.transaction(
    tx => {
      const customer = tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, input.customerId),
            eq(customers.tenantId, ctx.tenantId),
            eq(customers.isActive, true)
          )
        )
        .get();
      if (!customer) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_CUSTOMER_REQUIRED',
          message: 'Customer not found for this tenant',
        });
      }

      const existing = tx
        .select({ id: pharmacyCustomerAllergies.id })
        .from(pharmacyCustomerAllergies)
        .where(
          and(
            eq(pharmacyCustomerAllergies.tenantId, ctx.tenantId),
            eq(pharmacyCustomerAllergies.customerId, input.customerId),
            eq(pharmacyCustomerAllergies.activeIngredientNormalized, normalized)
          )
        )
        .get();
      if (existing) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_ALLERGY_DUPLICATE',
          message: 'This active-ingredient allergy is already registered for the customer',
        });
      }

      tx.insert(pharmacyCustomerAllergies)
        .values({
          id,
          tenantId: ctx.tenantId,
          customerId: input.customerId,
          activeIngredient: input.activeIngredient.trim(),
          activeIngredientNormalized: normalized,
          severity: input.severity,
          notes: input.notes?.trim() || null,
          createdBy: ctx.actorId,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        action: 'pharmacy.customer_allergy.create',
        resourceType: 'pharmacy_customer_allergy',
        resourceId: id,
        after: {
          customerId: input.customerId,
          severity: input.severity,
        },
      });

      return {
        id,
        customerId: input.customerId,
        activeIngredient: input.activeIngredient.trim(),
        severity: input.severity,
        notes: input.notes?.trim() || null,
        createdAt: now,
      };
    },
    { behavior: 'immediate' }
  );
}

export function removePharmacyCustomerAllergy(
  db: DatabaseInstance,
  ctx: { tenantId: string; actorId: string },
  input: RemovePharmacyCustomerAllergyInput
) {
  return db.transaction(
    tx => {
      const existing = tx
        .select({
          id: pharmacyCustomerAllergies.id,
          customerId: pharmacyCustomerAllergies.customerId,
          severity: pharmacyCustomerAllergies.severity,
        })
        .from(pharmacyCustomerAllergies)
        .where(
          and(
            eq(pharmacyCustomerAllergies.id, input.id),
            eq(pharmacyCustomerAllergies.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_ALLERGY_NOT_FOUND',
          message: 'Customer allergy record not found',
        });
      }

      tx.delete(pharmacyCustomerAllergies)
        .where(
          and(
            eq(pharmacyCustomerAllergies.id, existing.id),
            eq(pharmacyCustomerAllergies.tenantId, ctx.tenantId)
          )
        )
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        action: 'pharmacy.customer_allergy.delete',
        resourceType: 'pharmacy_customer_allergy',
        resourceId: existing.id,
        before: { customerId: existing.customerId, severity: existing.severity },
      });

      return { id: existing.id, removed: true };
    },
    { behavior: 'immediate' }
  );
}
