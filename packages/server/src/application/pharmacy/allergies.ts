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

export function listPharmacyCustomerAllergies(
  db: DatabaseInstance,
  tenantId: string,
  input: ListPharmacyCustomerAllergiesInput
) {
  const customer = db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId)))
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
        before: { customerId: existing.customerId },
      });

      return { id: existing.id, removed: true };
    },
    { behavior: 'immediate' }
  );
}
