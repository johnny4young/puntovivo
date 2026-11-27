/** Zod contracts for pharmacy policy, evidence, authorization and recall workflows. */

import { z } from 'zod';
import {
  pharmacyAllergySeverityEnum,
  pharmacyClassificationEnum,
  pharmacyEnvironmentalPeriodEnum,
  pharmacyEnvironmentalZoneEnum,
  pharmacyEvidenceStatusEnum,
  pharmacyInvimaStatusEnum,
  pharmacyRecallScopeEnum,
} from '../../db/schema.js';
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

export const pharmacyGenericAlternativesInput = z
  .object({
    productId: z.string().min(1),
    siteId: z.string().min(1).optional(),
    priceTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
    limit: z.number().int().min(1).max(5).default(3),
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

// --- Regulated lot fractionation (box -> blister -> tablet) ---

export const fractionatePharmacyLotInput = z
  .object({
    sourceLotId: z.string().min(1),
    targetProductId: z.string().min(1),
    sourceQuantity: positivePharmacyQuantity,
    targetQuantity: positivePharmacyQuantity,
    reason: boundedReason,
  })
  .strict();

export const listPharmacyFractionationsInput = paginationInput
  .extend({
    siteId: z.string().min(1).optional(),
  })
  .strict();

// --- Daily temperature & humidity logbook (Res. 1403/2007 CO) ---

export const recordPharmacyEnvironmentalLogInput = z
  .object({
    siteId: z.string().min(1).optional(),
    period: z.enum(pharmacyEnvironmentalPeriodEnum),
    zone: z.enum(pharmacyEnvironmentalZoneEnum),
    temperatureC: z.number().finite().min(-40).max(80),
    humidityPercent: z.number().finite().min(0).max(100).nullable().optional(),
    correctiveAction: z.string().trim().max(500).nullable().optional(),
    instrumentCode: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const listPharmacyEnvironmentalLogsInput = paginationInput
  .extend({
    siteId: z.string().min(1).optional(),
    fromDate: calendarDay.optional(),
    toDate: calendarDay.optional(),
    zone: z.enum(pharmacyEnvironmentalZoneEnum).optional(),
    onlyDeviations: z.boolean().optional(),
  })
  .strict();

export const getPharmacyEnvironmentalReportInput = z
  .object({
    siteId: z.string().min(1).optional(),
    fromDate: calendarDay,
    toDate: calendarDay,
    zone: z.enum(pharmacyEnvironmentalZoneEnum).optional(),
  })
  .strict()
  .refine(value => value.toDate >= value.fromDate, {
    message: 'End date cannot be before start date',
    path: ['toDate'],
  });

// --- Official INVIMA / CUM catalog importer ---

export const invimaCatalogRowInput = z
  .object({
    cumCode: z.string().trim().min(2).max(80),
    productName: z.string().trim().min(1).max(255),
    activeIngredient: z.string().trim().min(1).max(255),
    concentration: z.string().trim().max(120).nullable().optional(),
    dosageForm: z.string().trim().max(120).nullable().optional(),
    administrationRoute: z.string().trim().max(120).nullable().optional(),
    presentation: z.string().trim().max(255).nullable().optional(),
    dosesPerPack: z.number().int().positive().max(10_000).nullable().optional(),
    manufacturer: z.string().trim().max(255).nullable().optional(),
    authorizationHolder: z.string().trim().max(255).nullable().optional(),
    sanitaryRegistration: z.string().trim().min(2).max(160),
    registrationStatus: z.enum(pharmacyInvimaStatusEnum).optional(),
    registrationExpiresAt: calendarDay.nullable().optional(),
    classification: z.enum(pharmacyClassificationEnum).optional(),
  })
  .strict();

export const importPharmacyInvimaCatalogInput = z
  .object({
    csvText: z.string().min(1).max(2_000_000).optional(),
    rows: z.array(invimaCatalogRowInput).max(2_000).optional(),
    syncMatchingProducts: z.boolean().default(false),
  })
  .strict()
  .refine(value => Boolean(value.csvText?.trim()) || (value.rows && value.rows.length > 0), {
    message: 'Provide csvText or at least one INVIMA catalog row',
  });

export const searchPharmacyInvimaCatalogInput = paginationInput
  .extend({
    search: z.string().trim().max(160).optional(),
    status: z.enum(pharmacyInvimaStatusEnum).optional(),
  })
  .strict();

// --- Controlled medicines (FNE Colombia — Res. 1478/2006) ---

export const createPharmacyFneAuthorizationInput = z
  .object({
    siteId: z.string().min(1).nullable().optional(),
    countryCode,
    resolutionNumber: z.string().trim().min(3).max(160),
    issuingAuthority: z.string().trim().min(3).max(200),
    responsibleUserId: z.string().min(1),
    validFrom: calendarDay,
    validUntil: calendarDay.nullable().optional(),
  })
  .strict()
  .refine(value => !value.validUntil || value.validUntil >= value.validFrom, {
    message: 'FNE authorization end date cannot be before its start date',
    path: ['validUntil'],
  });

export const revokePharmacyFneAuthorizationInput = z
  .object({ id: z.string().min(1), reason: boundedReason })
  .strict();

export const listPharmacyFneAuthorizationsInput = paginationInput
  .extend({
    siteId: z.string().min(1).optional(),
    activeOnly: z.boolean().default(true),
  })
  .strict();

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM period');

export const getPharmacyFneMonthlyReportInput = z
  .object({
    siteId: z.string().min(1).optional(),
    month: yearMonth,
  })
  .strict();

// --- Patient allergies ---

export const listPharmacyCustomerAllergiesInput = z
  .object({
    customerId: z.string().min(1),
  })
  .strict();

export const addPharmacyCustomerAllergyInput = z
  .object({
    customerId: z.string().min(1),
    activeIngredient: z.string().trim().min(2).max(200),
    severity: z.enum(pharmacyAllergySeverityEnum).default('moderate'),
    notes: z.string().trim().max(400).nullable().optional(),
  })
  .strict();

export const removePharmacyCustomerAllergyInput = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export type CreatePharmacyAuthorizationInput = z.infer<typeof createPharmacyAuthorizationInput>;
export type RecordPharmacyEvidenceInput = z.infer<typeof recordPharmacyEvidenceInput>;
export type PharmacyCheckoutRequirementsInput = z.infer<typeof pharmacyCheckoutRequirementsInput>;
export type PharmacyGenericAlternativesInput = z.infer<typeof pharmacyGenericAlternativesInput>;
export type CreatePharmacyRecallInput = z.infer<typeof createPharmacyRecallInput>;
export type TransitionPharmacyLotInput = z.infer<typeof transitionPharmacyLotInput>;
export type DestroyPharmacyLotInput = z.infer<typeof destroyPharmacyLotInput>;
export type FractionatePharmacyLotInput = z.infer<typeof fractionatePharmacyLotInput>;
export type ListPharmacyFractionationsInput = z.infer<typeof listPharmacyFractionationsInput>;
export type RecordPharmacyEnvironmentalLogInput = z.infer<
  typeof recordPharmacyEnvironmentalLogInput
>;
export type ListPharmacyEnvironmentalLogsInput = z.infer<typeof listPharmacyEnvironmentalLogsInput>;
export type GetPharmacyEnvironmentalReportInput = z.infer<
  typeof getPharmacyEnvironmentalReportInput
>;
export type ImportPharmacyInvimaCatalogInput = z.infer<typeof importPharmacyInvimaCatalogInput>;
export type SearchPharmacyInvimaCatalogInput = z.infer<typeof searchPharmacyInvimaCatalogInput>;
export type CreatePharmacyFneAuthorizationInput = z.infer<
  typeof createPharmacyFneAuthorizationInput
>;
export type RevokePharmacyFneAuthorizationInput = z.infer<
  typeof revokePharmacyFneAuthorizationInput
>;
export type ListPharmacyFneAuthorizationsInput = z.infer<typeof listPharmacyFneAuthorizationsInput>;
export type GetPharmacyFneMonthlyReportInput = z.infer<typeof getPharmacyFneMonthlyReportInput>;
export type ListPharmacyCustomerAllergiesInput = z.infer<typeof listPharmacyCustomerAllergiesInput>;
export type AddPharmacyCustomerAllergyInput = z.infer<typeof addPharmacyCustomerAllergyInput>;
export type RemovePharmacyCustomerAllergyInput = z.infer<typeof removePharmacyCustomerAllergyInput>;
