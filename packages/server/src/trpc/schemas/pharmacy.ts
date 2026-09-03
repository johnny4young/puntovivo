/** Zod contracts for pharmacy policy, evidence, authorization and recall workflows. */

import { z } from 'zod';
import { pharmacyRecallScopeEnum, pharmacyEvidenceStatusEnum } from '../../db/schema.js';
import { paginationInput } from './common.js';

const calendarDay = z.iso.date({ error: 'Expected a valid YYYY-MM-DD calendar day' });
const countryCode = z
  .string()
  .trim()
  .length(2)
  .transform(value => value.toUpperCase());
const boundedReason = z.string().trim().min(3).max(500);
const positivePharmacyQuantity = z
  .number()
  .finite()
  .positive()
  .max(1_000_000_000)
  .transform(value => Math.round(value * 1_000_000_000) / 1_000_000_000)
  .refine(value => value > 0, 'Quantity is below the supported precision');

export const createPharmacyAuthorizationInput = z
  .object({
    userId: z.string().min(1),
    siteId: z.string().min(1).nullable().optional(),
    countryCode,
    credentialType: z.string().trim().min(2).max(80),
    credential: z.string().trim().min(3).max(160),
    validFrom: calendarDay,
    validUntil: calendarDay.nullable().optional(),
  })
  .strict()
  .refine(value => !value.validUntil || value.validUntil >= value.validFrom, {
    message: 'Authorization end date cannot be before its start date',
    path: ['validUntil'],
  });

export const listPharmacyAuthorizationsInput = paginationInput
  .extend({
    userId: z.string().min(1).optional(),
    siteId: z.string().min(1).optional(),
    activeOnly: z.boolean().default(true),
  })
  .strict();

export const revokePharmacyAuthorizationInput = z
  .object({ id: z.string().min(1), reason: boundedReason })
  .strict();

export const recordPharmacyEvidenceInput = z
  .object({
    productId: z.string().min(1),
    customerId: z.string().min(1),
    reference: z.string().trim().min(2).max(200),
    prescriberName: z.string().trim().min(2).max(160).nullable().optional(),
    prescriberCredential: z.string().trim().min(2).max(160).nullable().optional(),
    buyerDocument: z.string().trim().min(2).max(120).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    authorizedQuantity: positivePharmacyQuantity,
    validFrom: calendarDay,
    expiresAt: calendarDay,
  })
  .strict()
  .refine(value => value.expiresAt >= value.validFrom, {
    message: 'Prescription expiry cannot be before its start date',
    path: ['expiresAt'],
  });

export const listPharmacyEvidenceInput = paginationInput
  .extend({
    productId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    status: z.enum(pharmacyEvidenceStatusEnum).optional(),
  })
  .strict();

export const approvePharmacyEvidenceInput = z.object({ id: z.string().min(1) }).strict();
export const revokePharmacyEvidenceInput = z
  .object({ id: z.string().min(1), reason: boundedReason })
  .strict();

export const pharmacyCheckoutRequirementsInput = z
  .object({
    customerId: z.string().min(1).nullable().optional(),
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            quantity: positivePharmacyQuantity,
            unitEquivalence: positivePharmacyQuantity,
          })
          .strict()
      )
      .min(1)
      // Keep the preflight boundary aligned with the authoritative sale
      // contract. Otherwise a valid 101-200 line retail cart fails closed in
      // the payment modal even when it contains no regulated products.
      .max(200),
  })
  .strict();

export const createPharmacyRecallInput = z
  .object({
    scopeType: z.enum(pharmacyRecallScopeEnum),
    productId: z.string().min(1).optional(),
    lotId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    sanitaryRegistration: z.string().trim().min(1).max(160).optional(),
    reason: boundedReason,
  })
  .strict()
  .superRefine((value, ctx) => {
    const fields = {
      product: value.productId,
      lot: value.lotId,
      provider: value.providerId,
      sanitary_registration: value.sanitaryRegistration,
    } as const;
    const present = Object.values(fields).filter(Boolean);
    if (present.length !== 1 || !fields[value.scopeType]) {
      ctx.addIssue({
        code: 'custom',
        message: 'Recall scope must provide exactly its matching identifier',
      });
    }
  });

export const listPharmacyRecallsInput = paginationInput
  .extend({ status: z.enum(['active', 'closed']).optional() })
  .strict();
export const getPharmacyRecallInput = paginationInput.extend({ id: z.string().min(1) }).strict();
export const listPharmacyRecallAffectedSalesInput = paginationInput
  .extend({ id: z.string().min(1) })
  .strict();
export const closePharmacyRecallInput = z
  .object({ id: z.string().min(1), reason: boundedReason })
  .strict();

export const transitionPharmacyLotInput = z
  .object({
    lotId: z.string().min(1),
    action: z.enum(['quarantine', 'release', 'expiration', 'cold_chain_incident']),
    reason: boundedReason,
  })
  .strict();

export const destroyPharmacyLotInput = z
  .object({
    lotId: z.string().min(1),
    quantity: positivePharmacyQuantity,
    reason: boundedReason,
  })
  .strict();

export type CreatePharmacyAuthorizationInput = z.infer<typeof createPharmacyAuthorizationInput>;
export type RecordPharmacyEvidenceInput = z.infer<typeof recordPharmacyEvidenceInput>;
export type PharmacyCheckoutRequirementsInput = z.infer<typeof pharmacyCheckoutRequirementsInput>;
export type CreatePharmacyRecallInput = z.infer<typeof createPharmacyRecallInput>;
export type TransitionPharmacyLotInput = z.infer<typeof transitionPharmacyLotInput>;
export type DestroyPharmacyLotInput = z.infer<typeof destroyPharmacyLotInput>;
