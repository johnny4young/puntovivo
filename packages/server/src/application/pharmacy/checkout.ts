import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  pharmacyDispensations,
  pharmacyPrescriptionEvidence,
  pharmacyProfessionalAuthorizations,
  pharmacyProductProfiles,
  products,
  saleItems,
  sales,
  users,
} from '../../db/schema.js';
import { throwServerError, type ServerErrorCode } from '../../lib/errorCodes.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertTenantBusinessClockCurrent,
  isCalendarDateExpired,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { assertPharmacyProductPolicy } from '../../services/pharmacy/catalog-policy.js';
import {
  requireAuthenticPharmacyPrescriptionEvidence,
  requireAuthenticPharmacyProfessionalCredential,
} from '../../services/pharmacy/evidence-integrity.js';
import { resolvePharmacyPolicy } from '../../services/pharmacy/policy.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { PharmacyCheckoutRequirementsInput } from '../../trpc/schemas/pharmacy.js';
import { MAX_PHARMACY_EVIDENCE_IDS_PER_SALE } from '../../trpc/schemas/sales.js';
import {
  findEffectivePharmacyAuthorization,
  inspectPharmacyAuthorizationSnapshot,
  type PharmacyAuthorizationSnapshot,
} from './authorizations.js';

const roundQuantity = (value: number) => Math.round(value * 1_000_000_000) / 1_000_000_000;

interface PharmacySaleSyncContext {
  tenantId: string;
  actorId: string;
  siteId: string;
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}

function saleSyncContext(db: DatabaseInstance, ctx: PharmacySaleSyncContext) {
  return {
    db,
    tenantId: ctx.tenantId,
    ...(ctx.envelope === undefined ? {} : { envelope: ctx.envelope }),
    ...(ctx.deviceId === undefined ? {} : { deviceId: ctx.deviceId }),
  };
}

function policyBlockCode(args: {
  classification: 'otc' | 'prescription' | 'controlled';
  sanitaryRegistration: string | null;
  registrationExpiresAt: string | null;
  countryCode: string;
  businessDate: string;
  customerId: string | null;
}): ServerErrorCode | null {
  const decision = resolvePharmacyPolicy(args.countryCode, args.businessDate, args.classification);
  if (!decision.allowed) return decision.errorCode;
  if (
    decision.requiredProductFields.includes('sanitaryRegistration') &&
    !args.sanitaryRegistration?.trim()
  ) {
    return 'PHARMACY_PRODUCT_REGISTRATION_REQUIRED';
  }
  if (
    args.registrationExpiresAt &&
    isCalendarDateExpired(args.registrationExpiresAt, args.businessDate)
  ) {
    return 'PHARMACY_PRODUCT_REGISTRATION_EXPIRED';
  }
  if (decision.customerRequired && !args.customerId) return 'PHARMACY_CUSTOMER_REQUIRED';
  return null;
}

/** Safe preflight for the payment modal; no secret or customer PII is returned. */
export async function getPharmacyCheckoutRequirements(
  db: DatabaseInstance,
  ctx: { tenantId: string; siteId: string; userId: string },
  input: PharmacyCheckoutRequirementsInput
) {
  const { tenantId, siteId } = ctx;
  const clock = await resolveTenantBusinessClock(db, tenantId);
  const productIds = [...new Set(input.items.map(item => item.productId))];
  const profileRows =
    productIds.length === 0
      ? []
      : db
          .select({
            productId: products.id,
            productName: products.name,
            classification: pharmacyProductProfiles.classification,
            sanitaryRegistration: pharmacyProductProfiles.sanitaryRegistration,
            registrationExpiresAt: pharmacyProductProfiles.registrationExpiresAt,
          })
          .from(products)
          .innerJoin(
            pharmacyProductProfiles,
            and(
              eq(pharmacyProductProfiles.productId, products.id),
              eq(pharmacyProductProfiles.tenantId, tenantId)
            )
          )
          .where(
            and(
              eq(products.tenantId, tenantId),
              eq(products.isActive, true),
              inArray(products.id, productIds)
            )
          )
          .all();
  const profileByProduct = new Map(profileRows.map(profile => [profile.productId, profile]));
  const profiles = productIds.flatMap(productId => {
    const profile = profileByProduct.get(productId);
    return profile ? [profile] : [];
  });

  const requestedByProduct = new Map<string, number>();
  for (const item of input.items) {
    requestedByProduct.set(
      item.productId,
      roundQuantity(
        (requestedByProduct.get(item.productId) ?? 0) + item.quantity * item.unitEquivalence
      )
    );
  }

  const customerIsValid = input.customerId
    ? Boolean(
        db
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.id, input.customerId),
              eq(customers.tenantId, tenantId),
              eq(customers.isActive, true),
              eq(customers.privacyStatus, 'active')
            )
          )
          .get()
      )
    : false;

  const requirementContexts = profiles.map(profile => {
    const decision = resolvePharmacyPolicy(
      clock.countryCode,
      clock.businessDate,
      profile.classification
    );
    const blockCode = policyBlockCode({
      ...profile,
      countryCode: clock.countryCode,
      businessDate: clock.businessDate,
      customerId: customerIsValid ? (input.customerId ?? null) : null,
    });
    return { profile, decision, blockCode };
  });
  type EligibleEvidenceSummary = {
    id: string;
    authorizedQuantity: number;
    dispensedQuantity: number;
    validFrom: string;
    expiresAt: string;
    status: 'approved';
    remainingQuantity: number;
  };
  const evidenceByProduct = new Map<string, EligibleEvidenceSummary[]>();
  const eligibleEvidenceIds = new Set<string>();
  const evidenceSelectionLimitByProduct = new Set<string>();
  const authenticatedAuthorizationIds = new Set<string>();
  let remainingSelectionSlots = MAX_PHARMACY_EVIDENCE_IDS_PER_SALE;

  // The sale contract accepts at most 200 evidence ids. Read at most one row
  // beyond the remaining capacity for each regulated product, return only the
  // FEFO prefix needed by the cart, and expose an explicit fail-closed block if
  // fragmented prescriptions cannot fit that transport boundary. Iterating by
  // cart product keeps later products from being hidden by one unbounded JOIN.
  if (customerIsValid && input.customerId) {
    for (const { profile, decision, blockCode } of requirementContexts) {
      if (blockCode !== null || !decision.evidenceRequired) continue;
      const requestedQuantity = requestedByProduct.get(profile.productId) ?? 0;
      const rows = db
        .select({
          id: pharmacyPrescriptionEvidence.id,
          tenantId: pharmacyPrescriptionEvidence.tenantId,
          productId: pharmacyPrescriptionEvidence.productId,
          referenceDigest: pharmacyPrescriptionEvidence.referenceDigest,
          sealedEvidence: pharmacyPrescriptionEvidence.sealedEvidence,
          authorizedQuantity: pharmacyPrescriptionEvidence.authorizedQuantity,
          dispensedQuantity: pharmacyPrescriptionEvidence.dispensedQuantity,
          validFrom: pharmacyPrescriptionEvidence.validFrom,
          expiresAt: pharmacyPrescriptionEvidence.expiresAt,
          authorizationId: pharmacyProfessionalAuthorizations.id,
          authorizationTenantId: pharmacyProfessionalAuthorizations.tenantId,
          authorizationCountryCode: pharmacyProfessionalAuthorizations.countryCode,
          authorizationCredentialType: pharmacyProfessionalAuthorizations.credentialType,
          authorizationCredentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
          authorizationSealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
        })
        .from(pharmacyPrescriptionEvidence)
        .innerJoin(
          pharmacyProfessionalAuthorizations,
          and(
            eq(
              pharmacyProfessionalAuthorizations.id,
              pharmacyPrescriptionEvidence.approvalAuthorizationId
            ),
            eq(pharmacyProfessionalAuthorizations.tenantId, tenantId),
            eq(pharmacyProfessionalAuthorizations.userId, pharmacyPrescriptionEvidence.approvedBy),
            eq(pharmacyProfessionalAuthorizations.countryCode, clock.countryCode),
            eq(pharmacyProfessionalAuthorizations.status, 'active'),
            sql`${pharmacyProfessionalAuthorizations.validFrom} <= ${clock.businessDate}`,
            or(
              isNull(pharmacyProfessionalAuthorizations.validUntil),
              sql`${pharmacyProfessionalAuthorizations.validUntil} >= ${clock.businessDate}`
            ),
            or(
              isNull(pharmacyProfessionalAuthorizations.siteId),
              eq(pharmacyProfessionalAuthorizations.siteId, siteId)
            )
          )
        )
        .innerJoin(
          users,
          and(
            eq(users.id, pharmacyProfessionalAuthorizations.userId),
            eq(users.tenantId, tenantId),
            eq(users.isActive, true)
          )
        )
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.tenantId, tenantId),
            eq(pharmacyPrescriptionEvidence.productId, profile.productId),
            eq(pharmacyPrescriptionEvidence.customerId, input.customerId),
            eq(pharmacyPrescriptionEvidence.countryCode, clock.countryCode),
            eq(pharmacyPrescriptionEvidence.policyVersion, decision.policyVersion),
            eq(pharmacyPrescriptionEvidence.status, 'approved'),
            sql`${pharmacyPrescriptionEvidence.validFrom} <= ${clock.businessDate}`,
            sql`${pharmacyPrescriptionEvidence.expiresAt} >= ${clock.businessDate}`,
            sql`${pharmacyPrescriptionEvidence.dispensedQuantity} < ${pharmacyPrescriptionEvidence.authorizedQuantity}`
          )
        )
        .orderBy(
          asc(pharmacyPrescriptionEvidence.expiresAt),
          asc(pharmacyPrescriptionEvidence.createdAt),
          asc(pharmacyPrescriptionEvidence.id)
        )
        .limit(remainingSelectionSlots + 1)
        .all();

      const eligible: EligibleEvidenceSummary[] = [];
      let coveredQuantity = 0;
      for (const row of rows) {
        if (coveredQuantity + QUANTITY_EPSILON >= requestedQuantity) break;
        if (remainingSelectionSlots === 0) {
          evidenceSelectionLimitByProduct.add(profile.productId);
          break;
        }
        requireAuthenticPharmacyPrescriptionEvidence(row);
        if (!authenticatedAuthorizationIds.has(row.authorizationId)) {
          requireAuthenticPharmacyProfessionalCredential({
            id: row.authorizationId,
            tenantId: row.authorizationTenantId,
            countryCode: row.authorizationCountryCode,
            credentialType: row.authorizationCredentialType,
            credentialDigest: row.authorizationCredentialDigest,
            sealedCredential: row.authorizationSealedCredential,
          });
          authenticatedAuthorizationIds.add(row.authorizationId);
        }
        const remainingQuantity = roundQuantity(row.authorizedQuantity - row.dispensedQuantity);
        eligible.push({
          id: row.id,
          authorizedQuantity: row.authorizedQuantity,
          dispensedQuantity: row.dispensedQuantity,
          validFrom: row.validFrom,
          expiresAt: row.expiresAt,
          status: 'approved',
          remainingQuantity,
        });
        eligibleEvidenceIds.add(row.id);
        remainingSelectionSlots -= 1;
        coveredQuantity = roundQuantity(coveredQuantity + remainingQuantity);
      }
      evidenceByProduct.set(profile.productId, eligible);
    }
  }

  // Re-approval is a recovery surface, not a history browser. Only products
  // that still lack eligible quantity are scanned, each scan is bounded by the
  // same sale limit, and the response stops once the shortfall can be covered.
  const reapprovalByProduct = new Map<
    string,
    Array<{
      id: string;
      reasonCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' | 'PHARMACY_AUTHORIZATION_INVALID';
    }>
  >();
  let remainingReapprovalSlots = MAX_PHARMACY_EVIDENCE_IDS_PER_SALE;
  if (customerIsValid && input.customerId) {
    for (const { profile, decision, blockCode } of requirementContexts) {
      if (
        blockCode !== null ||
        !decision.evidenceRequired ||
        evidenceSelectionLimitByProduct.has(profile.productId) ||
        remainingReapprovalSlots === 0
      ) {
        continue;
      }
      const requestedQuantity = requestedByProduct.get(profile.productId) ?? 0;
      const eligibleQuantity = (evidenceByProduct.get(profile.productId) ?? []).reduce(
        (sum, evidence) => roundQuantity(sum + evidence.remainingQuantity),
        0
      );
      if (eligibleQuantity + QUANTITY_EPSILON >= requestedQuantity) continue;

      const rows = db
        .select({
          id: pharmacyPrescriptionEvidence.id,
          tenantId: pharmacyPrescriptionEvidence.tenantId,
          productId: pharmacyPrescriptionEvidence.productId,
          referenceDigest: pharmacyPrescriptionEvidence.referenceDigest,
          sealedEvidence: pharmacyPrescriptionEvidence.sealedEvidence,
          authorizedQuantity: pharmacyPrescriptionEvidence.authorizedQuantity,
          dispensedQuantity: pharmacyPrescriptionEvidence.dispensedQuantity,
          authorizationId: pharmacyProfessionalAuthorizations.id,
          authorizationTenantId: pharmacyProfessionalAuthorizations.tenantId,
          authorizationUserId: pharmacyProfessionalAuthorizations.userId,
          authorizationUserIsActive: users.isActive,
          authorizationSiteId: pharmacyProfessionalAuthorizations.siteId,
          authorizationCountryCode: pharmacyProfessionalAuthorizations.countryCode,
          authorizationCredentialType: pharmacyProfessionalAuthorizations.credentialType,
          authorizationCredentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
          authorizationSealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
          authorizationValidFrom: pharmacyProfessionalAuthorizations.validFrom,
          authorizationValidUntil: pharmacyProfessionalAuthorizations.validUntil,
          authorizationStatus: pharmacyProfessionalAuthorizations.status,
        })
        .from(pharmacyPrescriptionEvidence)
        .leftJoin(
          pharmacyProfessionalAuthorizations,
          and(
            eq(
              pharmacyProfessionalAuthorizations.id,
              pharmacyPrescriptionEvidence.approvalAuthorizationId
            ),
            eq(pharmacyProfessionalAuthorizations.tenantId, tenantId),
            eq(pharmacyProfessionalAuthorizations.userId, pharmacyPrescriptionEvidence.approvedBy),
            eq(
              pharmacyProfessionalAuthorizations.countryCode,
              pharmacyPrescriptionEvidence.countryCode
            )
          )
        )
        .leftJoin(
          users,
          and(eq(users.id, pharmacyProfessionalAuthorizations.userId), eq(users.tenantId, tenantId))
        )
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.tenantId, tenantId),
            eq(pharmacyPrescriptionEvidence.productId, profile.productId),
            eq(pharmacyPrescriptionEvidence.customerId, input.customerId),
            eq(pharmacyPrescriptionEvidence.countryCode, clock.countryCode),
            eq(pharmacyPrescriptionEvidence.policyVersion, decision.policyVersion),
            eq(pharmacyPrescriptionEvidence.status, 'approved'),
            sql`${pharmacyPrescriptionEvidence.validFrom} <= ${clock.businessDate}`,
            sql`${pharmacyPrescriptionEvidence.expiresAt} >= ${clock.businessDate}`,
            sql`${pharmacyPrescriptionEvidence.dispensedQuantity} < ${pharmacyPrescriptionEvidence.authorizedQuantity}`
          )
        )
        .orderBy(
          asc(pharmacyPrescriptionEvidence.expiresAt),
          asc(pharmacyPrescriptionEvidence.createdAt),
          asc(pharmacyPrescriptionEvidence.id)
        )
        .limit(
          MAX_PHARMACY_EVIDENCE_IDS_PER_SALE +
            (evidenceByProduct.get(profile.productId)?.length ?? 0) +
            1
        )
        .all();

      let recoverableQuantity = 0;
      const group: Array<{
        id: string;
        reasonCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' | 'PHARMACY_AUTHORIZATION_INVALID';
      }> = [];
      for (const row of rows) {
        if (eligibleEvidenceIds.has(row.id)) continue;
        if (remainingReapprovalSlots === 0) break;
        requireAuthenticPharmacyPrescriptionEvidence(row);
        const authorization: PharmacyAuthorizationSnapshot | null =
          row.authorizationId &&
          row.authorizationTenantId &&
          row.authorizationUserId &&
          row.authorizationCountryCode &&
          row.authorizationCredentialType &&
          row.authorizationCredentialDigest &&
          row.authorizationSealedCredential &&
          row.authorizationValidFrom &&
          row.authorizationStatus
            ? {
                id: row.authorizationId,
                tenantId: row.authorizationTenantId,
                userId: row.authorizationUserId,
                userIsActive: row.authorizationUserIsActive,
                siteId: row.authorizationSiteId,
                countryCode: row.authorizationCountryCode,
                credentialType: row.authorizationCredentialType,
                credentialDigest: row.authorizationCredentialDigest,
                sealedCredential: row.authorizationSealedCredential,
                validFrom: row.authorizationValidFrom,
                validUntil: row.authorizationValidUntil,
                status: row.authorizationStatus,
              }
            : null;
        const reasonCode = inspectPharmacyAuthorizationSnapshot(authorization, {
          tenantId,
          siteId,
          countryCode: clock.countryCode,
          businessDate: clock.businessDate,
        });
        if (
          reasonCode !== 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE' &&
          reasonCode !== 'PHARMACY_AUTHORIZATION_INVALID'
        ) {
          continue;
        }
        group.push({ id: row.id, reasonCode });
        remainingReapprovalSlots -= 1;
        recoverableQuantity = roundQuantity(
          recoverableQuantity + row.authorizedQuantity - row.dispensedQuantity
        );
        if (eligibleQuantity + recoverableQuantity + QUANTITY_EPSILON >= requestedQuantity) {
          break;
        }
      }
      if (group.length > 0) reapprovalByProduct.set(profile.productId, group);
    }
  }

  const requirements = requirementContexts.map(({ profile, decision, blockCode }) => {
    return {
      productId: profile.productId,
      productName: profile.productName,
      classification: profile.classification,
      requestedQuantity: requestedByProduct.get(profile.productId) ?? 0,
      policyVersion: decision.policyVersion,
      evidenceRequired: decision.evidenceRequired,
      professionalApprovalRequired: decision.professionalApprovalRequired,
      blockedErrorCode:
        blockCode ??
        (evidenceSelectionLimitByProduct.has(profile.productId)
          ? 'PHARMACY_EVIDENCE_SELECTION_INVALID'
          : null),
      eligibleEvidence: evidenceByProduct.get(profile.productId) ?? [],
      reapprovalEvidence: reapprovalByProduct.get(profile.productId) ?? [],
    };
  });
  return {
    countryCode: clock.countryCode,
    businessDate: clock.businessDate,
    customerValid: input.customerId ? customerIsValid : null,
    canApproveEvidence:
      requirementContexts.some(
        context => context.blockCode === null && context.decision.professionalApprovalRequired
      ) &&
      findEffectivePharmacyAuthorization(db, {
        tenantId,
        userId: ctx.userId,
        siteId,
        countryCode: clock.countryCode,
        businessDate: clock.businessDate,
      }) !== null,
    requirements,
    ready: requirements.every(
      requirement =>
        requirement.blockedErrorCode === null &&
        (!requirement.evidenceRequired ||
          requirement.eligibleEvidence.reduce(
            (sum, item) => roundQuantity(sum + item.remainingQuantity),
            0
          ) +
            QUANTITY_EPSILON >=
            requirement.requestedQuantity)
    ),
  };
}

/**
 * Allocate approved evidence while the sale transaction owns the SQLite
 * writer. Reads the authoritative persisted sale and line snapshots rather
 * than trusting cart input, then advances each evidence row with a versioned
 * WHERE before writing immutable dispensations.
 */
export function allocatePharmacyEvidenceForSale(
  db: DatabaseInstance,
  ctx: PharmacySaleSyncContext,
  args: {
    saleId: string;
    evidenceIds: readonly string[];
    countryCode: string;
    businessDate: string;
    timezone: string;
    localeVersion: number;
    nowIso: string;
  }
): { dispensationIds: string[]; syncOutboxIds: string[] } {
  assertTenantBusinessClockCurrent(db, ctx.tenantId, args);
  if (new Set(args.evidenceIds).size !== args.evidenceIds.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_EVIDENCE_SELECTION_INVALID',
      message: 'Prescription evidence selection contains duplicates',
    });
  }
  const sale = db
    .select({ id: sales.id, customerId: sales.customerId, status: sales.status })
    .from(sales)
    .where(and(eq(sales.id, args.saleId), eq(sales.tenantId, ctx.tenantId)))
    .get();
  if (!sale || sale.status !== 'completed') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID',
      message: 'Evidence can only be allocated to a completed tenant sale',
    });
  }

  const lines = db
    .select({
      saleItemId: saleItems.id,
      productId: saleItems.productId,
      quantity: saleItems.quantity,
      unitEquivalence: saleItems.unitEquivalence,
      classification: pharmacyProductProfiles.classification,
      sanitaryRegistration: pharmacyProductProfiles.sanitaryRegistration,
      registrationExpiresAt: pharmacyProductProfiles.registrationExpiresAt,
    })
    .from(saleItems)
    .innerJoin(products, eq(products.id, saleItems.productId))
    .leftJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, saleItems.productId),
        eq(pharmacyProductProfiles.tenantId, ctx.tenantId)
      )
    )
    .where(and(eq(saleItems.saleId, sale.id), eq(products.tenantId, ctx.tenantId)))
    .all();
  const medicineLines = lines.filter(
    (line): line is typeof line & { classification: 'otc' | 'prescription' | 'controlled' } =>
      line.classification !== null
  );

  const selectedEvidence =
    args.evidenceIds.length === 0
      ? []
      : db
          .select()
          .from(pharmacyPrescriptionEvidence)
          .where(
            and(
              eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId),
              inArray(pharmacyPrescriptionEvidence.id, [...args.evidenceIds])
            )
          )
          // Evidence follows FEFO just like physical lots. The explicit
          // tiebreakers keep dispensed balances reproducible across SQLite
          // versions instead of depending on an unordered IN scan.
          .orderBy(
            asc(pharmacyPrescriptionEvidence.expiresAt),
            asc(pharmacyPrescriptionEvidence.createdAt),
            asc(pharmacyPrescriptionEvidence.id)
          )
          .all();
  if (selectedEvidence.length !== args.evidenceIds.length) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PHARMACY_EVIDENCE_NOT_FOUND',
      message: 'One or more prescription evidence rows were not found',
    });
  }
  for (const evidence of selectedEvidence) {
    requireAuthenticPharmacyPrescriptionEvidence(evidence);
  }
  const evidenceByProduct = new Map<string, typeof selectedEvidence>();
  for (const evidence of selectedEvidence) {
    const rows = evidenceByProduct.get(evidence.productId) ?? [];
    rows.push(evidence);
    evidenceByProduct.set(evidence.productId, rows);
  }

  const lineAllocations: Array<{
    saleItemId: string;
    productId: string;
    evidenceId: string;
    authorizationId: string;
    classification: 'prescription';
    policyVersion: string;
    quantity: number;
  }> = [];
  const evidenceTotals = new Map<string, number>();
  const usedEvidence = new Set<string>();

  for (const line of medicineLines) {
    const decision = assertPharmacyProductPolicy({
      profile: line,
      countryCode: args.countryCode,
      businessDate: args.businessDate,
      customerId: sale.customerId,
    });
    const baseQuantity = roundQuantity(line.quantity * line.unitEquivalence);
    if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PHARMACY_EVIDENCE_QUANTITY_EXCEEDED',
        message: 'Medicine quantity is invalid',
      });
    }
    if (decision.maxQuantity !== null && baseQuantity > decision.maxQuantity) {
      throwServerError({
        trpcCode: 'PRECONDITION_FAILED',
        errorCode: 'PHARMACY_EVIDENCE_QUANTITY_EXCEEDED',
        message: 'Medicine quantity exceeds the policy maximum',
      });
    }
    if (!decision.evidenceRequired) continue;
    if (!sale.customerId) {
      throwServerError({
        trpcCode: 'PRECONDITION_FAILED',
        errorCode: 'PHARMACY_CUSTOMER_REQUIRED',
        message: 'A customer is required for prescription evidence',
      });
    }

    let remaining = baseQuantity;
    for (const evidence of evidenceByProduct.get(line.productId) ?? []) {
      if (remaining <= QUANTITY_EPSILON) break;
      if (evidence.productId !== line.productId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_EVIDENCE_PRODUCT_MISMATCH',
          message: 'Prescription evidence belongs to another product',
        });
      }
      if (evidence.customerId !== sale.customerId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_EVIDENCE_CUSTOMER_MISMATCH',
          message: 'Prescription evidence belongs to another customer',
        });
      }
      if (
        !decision.allowedEvidenceStatuses.includes(evidence.status as 'approved') ||
        !evidence.approvedBy ||
        !evidence.approvalAuthorizationId
      ) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_EVIDENCE_NOT_APPROVED',
          message: 'Prescription evidence is not approved',
        });
      }
      if (
        evidence.countryCode !== args.countryCode ||
        evidence.policyVersion !== decision.policyVersion ||
        evidence.validFrom > args.businessDate ||
        isCalendarDateExpired(evidence.expiresAt, args.businessDate)
      ) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_EVIDENCE_EXPIRED',
          message: 'Prescription evidence is not effective for this sale',
        });
      }
      const authorization = db
        .select({
          id: pharmacyProfessionalAuthorizations.id,
          tenantId: pharmacyProfessionalAuthorizations.tenantId,
          countryCode: pharmacyProfessionalAuthorizations.countryCode,
          credentialType: pharmacyProfessionalAuthorizations.credentialType,
          credentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
          sealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
        })
        .from(pharmacyProfessionalAuthorizations)
        .innerJoin(
          users,
          and(
            eq(users.id, pharmacyProfessionalAuthorizations.userId),
            eq(users.tenantId, ctx.tenantId),
            eq(users.isActive, true)
          )
        )
        .where(
          and(
            eq(pharmacyProfessionalAuthorizations.id, evidence.approvalAuthorizationId),
            eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyProfessionalAuthorizations.userId, evidence.approvedBy),
            eq(pharmacyProfessionalAuthorizations.countryCode, args.countryCode),
            eq(pharmacyProfessionalAuthorizations.status, 'active'),
            sql`${pharmacyProfessionalAuthorizations.validFrom} <= ${args.businessDate}`,
            or(
              isNull(pharmacyProfessionalAuthorizations.validUntil),
              sql`${pharmacyProfessionalAuthorizations.validUntil} >= ${args.businessDate}`
            ),
            or(
              isNull(pharmacyProfessionalAuthorizations.siteId),
              eq(pharmacyProfessionalAuthorizations.siteId, ctx.siteId)
            )
          )
        )
        .get();
      if (!authorization) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE',
          message: 'Evidence approval authorization is no longer effective',
        });
      }
      requireAuthenticPharmacyProfessionalCredential(authorization);
      const alreadyAllocated = evidenceTotals.get(evidence.id) ?? 0;
      const available = roundQuantity(
        evidence.authorizedQuantity - evidence.dispensedQuantity - alreadyAllocated
      );
      if (available <= QUANTITY_EPSILON) continue;
      const quantity = roundQuantity(Math.min(remaining, available));
      lineAllocations.push({
        saleItemId: line.saleItemId,
        productId: line.productId,
        evidenceId: evidence.id,
        authorizationId: authorization.id,
        classification: 'prescription',
        policyVersion: decision.policyVersion,
        quantity,
      });
      evidenceTotals.set(evidence.id, roundQuantity(alreadyAllocated + quantity));
      usedEvidence.add(evidence.id);
      remaining = roundQuantity(remaining - quantity);
    }
    if (remaining > QUANTITY_EPSILON) {
      throwServerError({
        trpcCode: 'PRECONDITION_FAILED',
        errorCode: 'PHARMACY_EVIDENCE_QUANTITY_EXCEEDED',
        message: 'Approved prescription quantity is insufficient',
        details: { productId: line.productId, shortfall: remaining },
      });
    }
  }

  if (usedEvidence.size !== args.evidenceIds.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_EVIDENCE_SELECTION_INVALID',
      message: 'Selected evidence does not match a regulated sale line',
    });
  }

  const syncOutboxIds: string[] = [];
  for (const evidence of selectedEvidence) {
    const allocated = evidenceTotals.get(evidence.id);
    if (!allocated) continue;
    const calculatedDispensed = roundQuantity(evidence.dispensedQuantity + allocated);
    const nextStatus = calculatedDispensed >= evidence.authorizedQuantity ? 'consumed' : 'approved';
    const nextDispensed = calculatedDispensed;
    const update = db
      .update(pharmacyPrescriptionEvidence)
      .set({
        dispensedQuantity: nextDispensed,
        status: nextStatus,
        version: evidence.version + 1,
        updatedAt: args.nowIso,
      })
      .where(
        and(
          eq(pharmacyPrescriptionEvidence.id, evidence.id),
          eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId),
          eq(pharmacyPrescriptionEvidence.status, 'approved'),
          eq(pharmacyPrescriptionEvidence.version, evidence.version),
          eq(pharmacyPrescriptionEvidence.dispensedQuantity, evidence.dispensedQuantity)
        )
      )
      .run() as { changes?: number };
    if ((update.changes ?? 0) !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PHARMACY_EVIDENCE_QUANTITY_EXCEEDED',
        message: 'Prescription evidence was consumed concurrently',
      });
    }
    writeAuditLog({
      tx: db,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: 'pharmacy.evidence.dispense',
      resourceType: 'pharmacy_prescription_evidence',
      resourceId: evidence.id,
      before: { dispensedQuantity: evidence.dispensedQuantity, status: evidence.status },
      after: { dispensedQuantity: nextDispensed, status: nextStatus },
      metadata: { saleId: args.saleId, quantity: allocated },
      operationId: ctx.envelope?.operationId,
    });
    syncOutboxIds.push(
      enqueueSyncInTransaction(saleSyncContext(db, ctx), {
        entityType: 'pharmacy_prescription_evidence',
        entityId: evidence.id,
        operation: 'update',
        data: {
          id: evidence.id,
          dispensedQuantity: nextDispensed,
          status: nextStatus,
          version: evidence.version + 1,
        },
      }).id
    );
  }

  const dispensationIds: string[] = [];
  for (const allocation of lineAllocations) {
    const id = nanoid();
    db.insert(pharmacyDispensations)
      .values({
        id,
        tenantId: ctx.tenantId,
        saleId: args.saleId,
        saleItemId: allocation.saleItemId,
        productId: allocation.productId,
        customerId: sale.customerId!,
        evidenceId: allocation.evidenceId,
        authorizationId: allocation.authorizationId,
        classification: allocation.classification,
        policyVersion: allocation.policyVersion,
        quantity: allocation.quantity,
        businessDate: args.businessDate,
        createdAt: args.nowIso,
      })
      .run();
    dispensationIds.push(id);
    syncOutboxIds.push(
      enqueueSyncInTransaction(saleSyncContext(db, ctx), {
        entityType: 'pharmacy_dispensations',
        entityId: id,
        operation: 'create',
        data: { id, saleId: args.saleId, ...allocation, businessDate: args.businessDate },
      }).id
    );
  }
  return { dispensationIds, syncOutboxIds };
}
