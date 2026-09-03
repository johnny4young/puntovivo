import { and, eq, or } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  inventoryLots,
  pharmacyPrescriptionEvidence,
  pharmacyProductProfiles,
  pharmacyRecalls,
  saleItems,
  sales,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { PharmacyProductProfileInput } from '../../trpc/schemas/products.js';

export function assertPharmacyInventoryPolicy(input: {
  profile: PharmacyProductProfileInput | null | undefined;
  tracksStock: boolean;
  tracksLots: boolean;
  tracksSerials: boolean;
}): void {
  if (!input.profile) return;
  if (!input.tracksStock || !input.tracksLots || input.tracksSerials) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_PRODUCT_LOT_TRACKING_REQUIRED',
      message: 'A pharmacy medicine must use stock and lot tracking without serial tracking',
    });
  }
}

const CLASSIFICATION_RANK = { otc: 0, prescription: 1, controlled: 2 } as const;

export function normalizeSanitaryRegistration(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}

function pharmacyProfileValues(profile: PharmacyProductProfileInput) {
  return {
    activeIngredient: profile.activeIngredient ?? null,
    genericName: profile.genericName ?? null,
    concentration: profile.concentration ?? null,
    dosageForm: profile.dosageForm ?? null,
    administrationRoute: profile.administrationRoute ?? null,
    presentation: profile.presentation ?? null,
    manufacturer: profile.manufacturer ?? null,
    authorizationHolder: profile.authorizationHolder ?? null,
    sanitaryRegistration: profile.sanitaryRegistration ?? null,
    sanitaryRegistrationNormalized: profile.sanitaryRegistration
      ? normalizeSanitaryRegistration(profile.sanitaryRegistration)
      : null,
    registrationExpiresAt: profile.registrationExpiresAt ?? null,
    classification: profile.classification,
    storageConditions: profile.storageConditions ?? null,
    requiresColdChain: profile.requiresColdChain,
  } as const;
}

/** Avoid audit and local trace rows when a full product form resubmits an unchanged profile. */
export function pharmacyProductProfileMatches(
  existing: typeof pharmacyProductProfiles.$inferSelect | null | undefined,
  profile: PharmacyProductProfileInput | null
): boolean {
  if (!existing || !profile) return !existing && !profile;
  const next = pharmacyProfileValues(profile);
  return (Object.keys(next) as Array<keyof typeof next>).every(key => existing[key] === next[key]);
}

export function listActivePharmacyRecallLocks(
  db: DatabaseInstance,
  input: {
    tenantId: string;
    productId: string;
    sanitaryRegistration?: string | null | undefined;
  }
): Array<'product' | 'sanitary_registration'> {
  const normalizedRegistration = input.sanitaryRegistration?.trim()
    ? normalizeSanitaryRegistration(input.sanitaryRegistration)
    : null;
  return db
    .selectDistinct({ scopeType: pharmacyRecalls.scopeType })
    .from(pharmacyRecalls)
    .where(
      and(
        eq(pharmacyRecalls.tenantId, input.tenantId),
        eq(pharmacyRecalls.status, 'active'),
        or(
          and(
            eq(pharmacyRecalls.scopeType, 'product'),
            eq(pharmacyRecalls.productId, input.productId)
          ),
          normalizedRegistration
            ? and(
                eq(pharmacyRecalls.scopeType, 'sanitary_registration'),
                eq(pharmacyRecalls.sanitaryRegistration, normalizedRegistration)
              )
            : undefined
        )
      )
    )
    .limit(2)
    .all()
    .map(row => row.scopeType as 'product' | 'sanitary_registration');
}

export interface PharmacyProfileTransitionState {
  hasOpenDraft: boolean;
  hasLotHistory: boolean;
  hasEvidenceHistory: boolean;
  activeRecallScopes: Array<'product' | 'sanitary_registration'>;
}

export type PharmacyProfileLockReason =
  | 'stock'
  | 'open_draft'
  | 'lot_history'
  | 'evidence_history'
  | 'active_product_recall'
  | 'active_registration_recall';

/** One authoritative read model shared by the mutation guard and edit UI. */
export function getPharmacyProfileTransitionState(
  db: DatabaseInstance,
  input: {
    tenantId: string;
    productId: string;
    sanitaryRegistration?: string | null | undefined;
  }
): PharmacyProfileTransitionState {
  const hasOpenDraft = Boolean(
    db
      .select({ id: saleItems.id })
      .from(saleItems)
      .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, input.tenantId)))
      .where(and(eq(saleItems.productId, input.productId), eq(sales.status, 'draft')))
      .get()
  );
  const hasLotHistory = Boolean(
    db
      .select({ id: inventoryLots.id })
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.tenantId, input.tenantId),
          eq(inventoryLots.productId, input.productId)
        )
      )
      .get()
  );
  const hasEvidenceHistory = Boolean(
    db
      .select({ id: pharmacyPrescriptionEvidence.id })
      .from(pharmacyPrescriptionEvidence)
      .where(
        and(
          eq(pharmacyPrescriptionEvidence.tenantId, input.tenantId),
          eq(pharmacyPrescriptionEvidence.productId, input.productId)
        )
      )
      .get()
  );
  return {
    hasOpenDraft,
    hasLotHistory,
    hasEvidenceHistory,
    activeRecallScopes: listActivePharmacyRecallLocks(db, input),
  };
}

export function getPharmacyProfileLockReasons(
  currentStock: number,
  state: PharmacyProfileTransitionState
): PharmacyProfileLockReason[] {
  const reasons: PharmacyProfileLockReason[] = [];
  if (!Number.isFinite(currentStock) || Math.abs(currentStock) > 1e-9) reasons.push('stock');
  if (state.hasOpenDraft) reasons.push('open_draft');
  if (state.hasLotHistory) reasons.push('lot_history');
  if (state.hasEvidenceHistory) reasons.push('evidence_history');
  if (state.activeRecallScopes.includes('product')) reasons.push('active_product_recall');
  if (state.activeRecallScopes.includes('sanitary_registration')) {
    reasons.push('active_registration_recall');
  }
  return reasons;
}

/** Protect regulated classification and lot-bound registration identity. */
export function assertPharmacyProfileTransitionAllowed(input: {
  existing:
    | {
        classification: keyof typeof CLASSIFICATION_RANK;
        sanitaryRegistration?: string | null | undefined;
        requiresColdChain?: boolean | undefined;
      }
    | null
    | undefined;
  next:
    | {
        classification: keyof typeof CLASSIFICATION_RANK;
        sanitaryRegistration?: string | null | undefined;
        requiresColdChain?: boolean | undefined;
      }
    | null
    | undefined;
  currentStock: number;
  hasOpenDraft?: boolean;
  hasLotHistory?: boolean;
  hasEvidenceHistory?: boolean;
  activeRecallScopes?: ReadonlyArray<'product' | 'sanitary_registration'>;
}): void {
  if (!input.existing) {
    if (
      input.next &&
      (!Number.isFinite(input.currentStock) ||
        Math.abs(input.currentStock) > 1e-9 ||
        input.hasOpenDraft ||
        input.hasLotHistory ||
        input.hasEvidenceHistory)
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
        message: 'Existing inventory requires an explicit regulated pharmacy adoption workflow',
        details: {
          reason: 'pharmacy_profile_adoption_required',
          currentStock: input.currentStock,
          hasOpenDraft: input.hasOpenDraft ?? false,
          hasLotHistory: input.hasLotHistory ?? false,
          hasEvidenceHistory: input.hasEvidenceHistory ?? false,
        },
      });
    }
    return;
  }
  const previousRank = CLASSIFICATION_RANK[input.existing.classification];
  const nextRank = input.next ? CLASSIFICATION_RANK[input.next.classification] : -1;
  const regulationWasRelaxed = nextRank < previousRank;
  const stockIsNotSafelyEmpty =
    !Number.isFinite(input.currentStock) || Math.abs(input.currentStock) > 1e-9;
  if (regulationWasRelaxed && (stockIsNotSafelyEmpty || input.hasOpenDraft)) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message: 'A medicine with stock or an open draft cannot remove or relax its classification',
      details: {
        reason: 'classification_in_use',
        previousClassification: input.existing.classification,
        nextClassification: input.next?.classification ?? null,
        currentStock: input.currentStock,
        hasOpenDraft: input.hasOpenDraft ?? false,
      },
    });
  }

  const coldChainWasRelaxed =
    input.existing.requiresColdChain === true &&
    input.next !== null &&
    input.next !== undefined &&
    input.next.requiresColdChain !== true;
  if (coldChainWasRelaxed && (stockIsNotSafelyEmpty || input.hasOpenDraft)) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message: 'A medicine with stock or an open draft cannot remove cold-chain handling',
      details: {
        reason: 'cold_chain_in_use',
        currentStock: input.currentStock,
        hasOpenDraft: input.hasOpenDraft ?? false,
      },
    });
  }

  const coldChainWasIntroduced =
    input.existing.requiresColdChain !== true && input.next?.requiresColdChain === true;
  if (coldChainWasIntroduced && (stockIsNotSafelyEmpty || input.hasOpenDraft)) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message:
        'Existing stock cannot acquire a cold-chain claim without an explicit regulated adoption workflow',
      details: {
        reason: 'cold_chain_adoption_required',
        currentStock: input.currentStock,
        hasOpenDraft: input.hasOpenDraft ?? false,
      },
    });
  }

  const previousRegistration = input.existing.sanitaryRegistration?.trim()
    ? normalizeSanitaryRegistration(input.existing.sanitaryRegistration)
    : null;
  const nextRegistration = input.next?.sanitaryRegistration?.trim()
    ? normalizeSanitaryRegistration(input.next.sanitaryRegistration)
    : null;
  // Removing the whole medicine profile is a distinct, durable-history
  // violation. Report it before the narrower registration transition so the
  // caller receives the operation it must correct rather than a side effect
  // of the profile removal.
  if (!input.next && input.hasLotHistory) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message: 'A medicine profile associated with lot history cannot be removed',
      details: { reason: 'pharmacy_profile_has_lot_history' },
    });
  }
  if (!input.next && input.hasEvidenceHistory) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message: 'A medicine profile associated with prescription evidence cannot be removed',
      details: { reason: 'pharmacy_profile_has_evidence_history' },
    });
  }
  // Once a non-empty registration has identified physical custody or sealed
  // prescription evidence, changing it would silently rebind immutable
  // history to another regulated identity. Formatting-only corrections remain
  // safe because every boundary uses the same normalized value. A missing
  // registration may still be completed so an operator can recover a blocked
  // Colombian catalog entry.
  if (
    previousRegistration &&
    previousRegistration !== nextRegistration &&
    (input.hasLotHistory || input.hasEvidenceHistory)
  ) {
    const reason = input.hasLotHistory
      ? 'sanitary_registration_has_lot_history'
      : 'sanitary_registration_has_evidence_history';
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message:
        'A sanitary registration associated with regulated history cannot be changed or removed',
      details: {
        reason,
        previousSanitaryRegistration: previousRegistration,
        nextSanitaryRegistration: nextRegistration,
      },
    });
  }
  const activeRecallScopes = input.activeRecallScopes ?? [];
  const removesProfileUnderRecall = !input.next && activeRecallScopes.length > 0;
  const changesRecalledRegistration =
    previousRegistration !== nextRegistration &&
    activeRecallScopes.includes('sanitary_registration');
  if (removesProfileUnderRecall || changesRecalledRegistration) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_LOCKED',
      message: 'An active recall prevents changing the pharmacy identity it targets',
      details: {
        reason: 'active_recall',
        activeRecallScopes,
        previousSanitaryRegistration: previousRegistration,
        nextSanitaryRegistration: nextRegistration,
      },
    });
  }
}

/** Replace the optional profile inside its owning product transaction. */
export function replacePharmacyProductProfile(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    productId: string;
    profile: PharmacyProductProfileInput | null;
    now: string;
  }
): void {
  const existing = db
    .select({ productId: pharmacyProductProfiles.productId })
    .from(pharmacyProductProfiles)
    .where(
      and(
        eq(pharmacyProductProfiles.tenantId, args.tenantId),
        eq(pharmacyProductProfiles.productId, args.productId)
      )
    )
    .get();

  if (!args.profile) {
    if (existing) {
      db.delete(pharmacyProductProfiles)
        .where(
          and(
            eq(pharmacyProductProfiles.tenantId, args.tenantId),
            eq(pharmacyProductProfiles.productId, args.productId)
          )
        )
        .run();
    }
    return;
  }

  const values = {
    ...pharmacyProfileValues(args.profile),
    updatedAt: args.now,
  } as const;

  if (existing) {
    db.update(pharmacyProductProfiles)
      .set(values)
      .where(
        and(
          eq(pharmacyProductProfiles.tenantId, args.tenantId),
          eq(pharmacyProductProfiles.productId, args.productId)
        )
      )
      .run();
    return;
  }

  db.insert(pharmacyProductProfiles)
    .values({
      productId: args.productId,
      tenantId: args.tenantId,
      ...values,
      createdAt: args.now,
    })
    .run();
}
