import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  pharmacyPrescriptionEvidence,
  pharmacyProfessionalAuthorizations,
  pharmacyProductProfiles,
  products,
  users,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  digestPharmacyReference,
  hasPharmacyEvidenceKey,
  sealPharmacyEvidence,
} from '../../services/pharmacy/evidence-box.js';
import { requireAuthenticPharmacyPrescriptionEvidence } from '../../services/pharmacy/evidence-integrity.js';
import {
  assertTenantBusinessClockCurrent,
  isCalendarDateExpired,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { assertPharmacyProductPolicy } from '../../services/pharmacy/catalog-policy.js';
import { resolvePharmacyPolicy } from '../../services/pharmacy/policy.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { RecordPharmacyEvidenceInput } from '../../trpc/schemas/pharmacy.js';
import {
  findEffectivePharmacyAuthorization,
  inspectPharmacyAuthorizationSnapshot,
  type PharmacyAuthorizationSnapshot,
} from './authorizations.js';
import { clampPharmacyPage, pharmacySyncContext, type CriticalPharmacyContext } from './types.js';

function requireEvidenceKey(): void {
  if (!hasPharmacyEvidenceKey()) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE',
      message: 'Prescription evidence encryption is unavailable',
    });
  }
}

function getMedicineAndCustomer(
  db: DatabaseInstance,
  tenantId: string,
  productId: string,
  customerId: string
) {
  const medicine = db
    .select({
      productId: products.id,
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
      and(eq(products.id, productId), eq(products.tenantId, tenantId), eq(products.isActive, true))
    )
    .get();
  if (!medicine) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PHARMACY_PRODUCT_PROFILE_REQUIRED',
      message: 'Pharmacy product profile not found',
    });
  }
  const customer = db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.tenantId, tenantId),
        eq(customers.isActive, true),
        eq(customers.privacyStatus, 'active')
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
  return medicine;
}

export async function recordPharmacyEvidence(
  ctx: CriticalPharmacyContext,
  input: RecordPharmacyEvidenceInput
) {
  requireEvidenceKey();
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const id = nanoid();
  const digest = digestPharmacyReference(input.reference, {
    purpose: 'prescription',
    tenantId: ctx.tenantId,
    subjectId: input.productId,
  });
  const legacyDigest = digestPharmacyReference(input.reference, 'prescription');
  const sealedEvidence = sealPharmacyEvidence(
    {
      reference: input.reference,
      prescriberName: input.prescriberName ?? null,
      prescriberCredential: input.prescriberCredential ?? null,
      buyerDocument: input.buyerDocument ?? null,
      notes: input.notes ?? null,
    },
    { purpose: 'prescription', tenantId: ctx.tenantId, subjectId: id }
  );

  try {
    return ctx.db.transaction(
      tx => {
        assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
        // Resolve the policy only after reserving the writer. Otherwise a
        // concurrent catalog reclassification or customer privacy change
        // could validate one policy and persist evidence under another.
        const medicine = getMedicineAndCustomer(
          tx,
          ctx.tenantId,
          input.productId,
          input.customerId
        );
        const policy = assertPharmacyProductPolicy({
          profile: medicine,
          countryCode: clock.countryCode,
          businessDate: clock.businessDate,
          customerId: input.customerId,
        });
        if (!policy.evidenceRequired || medicine.classification !== 'prescription') {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'PHARMACY_EVIDENCE_INVALID',
            message: 'Prescription evidence is not valid for this product classification',
          });
        }
        const missingEvidenceField = policy.requiredEvidenceFields.find(
          field => !input[field]?.trim()
        );
        if (missingEvidenceField) {
          throwServerError({
            trpcCode: 'PRECONDITION_FAILED',
            errorCode: 'PHARMACY_EVIDENCE_INVALID',
            message: 'The effective policy requires additional prescription evidence',
            details: { field: missingEvidenceField, policyVersion: policy.policyVersion },
          });
        }
        const duplicate = tx
          .select({ id: pharmacyPrescriptionEvidence.id })
          .from(pharmacyPrescriptionEvidence)
          .where(
            and(
              eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId),
              eq(pharmacyPrescriptionEvidence.productId, input.productId),
              inArray(pharmacyPrescriptionEvidence.referenceDigest, [digest, legacyDigest])
            )
          )
          .get();
        if (duplicate) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'PHARMACY_EVIDENCE_ALREADY_EXISTS',
            message: 'Prescription reference is already registered for this product',
          });
        }
        tx.insert(pharmacyPrescriptionEvidence)
          .values({
            id,
            tenantId: ctx.tenantId,
            productId: input.productId,
            customerId: input.customerId,
            countryCode: clock.countryCode,
            policyVersion: policy.policyVersion,
            referenceDigest: digest,
            sealedEvidence,
            authorizedQuantity: input.authorizedQuantity,
            dispensedQuantity: 0,
            validFrom: input.validFrom,
            expiresAt: input.expiresAt,
            status: 'pending',
            createdBy: ctx.user.id,
            version: 0,
            createdAt: clock.nowIso,
            updatedAt: clock.nowIso,
          })
          .run();
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'pharmacy.evidence.record',
          resourceType: 'pharmacy_prescription_evidence',
          resourceId: id,
          before: null,
          after: {
            productId: input.productId,
            customerId: input.customerId,
            countryCode: clock.countryCode,
            policyVersion: policy.policyVersion,
            authorizedQuantity: input.authorizedQuantity,
            validFrom: input.validFrom,
            expiresAt: input.expiresAt,
            status: 'pending',
          },
          operationId: ctx.envelope.operationId,
        });
        enqueueSyncInTransaction(pharmacySyncContext(ctx, tx), {
          entityType: 'pharmacy_prescription_evidence',
          entityId: id,
          operation: 'create',
          data: {
            // Metadata-only until regulated remote apply and key exchange are
            // implemented; the sealed payload remains in the source table.
            id,
            productId: input.productId,
            customerId: input.customerId,
            countryCode: clock.countryCode,
            policyVersion: policy.policyVersion,
            authorizedQuantity: input.authorizedQuantity,
            dispensedQuantity: 0,
            validFrom: input.validFrom,
            expiresAt: input.expiresAt,
            status: 'pending',
          },
        });
        const result = { id, status: 'pending' as const };
        ctx.completeInTransaction(tx, result);
        return result;
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: pharmacy_prescription_evidence\.tenant_id, pharmacy_prescription_evidence\.product_id, pharmacy_prescription_evidence\.reference_digest/i.test(
        error.message
      )
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'PHARMACY_EVIDENCE_ALREADY_EXISTS',
        message: 'Prescription reference is already registered for this product',
      });
    }
    throw error;
  }
}

export function listPharmacyEvidence(
  db: DatabaseInstance,
  tenantId: string,
  input: {
    productId?: string | undefined;
    customerId?: string | undefined;
    status?: 'pending' | 'approved' | 'consumed' | 'revoked' | undefined;
    page: number;
    perPage: number;
  },
  context: {
    siteId: string | null;
    countryCode: string;
    businessDate: string;
  }
) {
  const filters = [eq(pharmacyPrescriptionEvidence.tenantId, tenantId)];
  if (input.productId) filters.push(eq(pharmacyPrescriptionEvidence.productId, input.productId));
  if (input.customerId) filters.push(eq(pharmacyPrescriptionEvidence.customerId, input.customerId));
  if (input.status) filters.push(eq(pharmacyPrescriptionEvidence.status, input.status));
  const where = and(...filters);
  const total = Number(
    db
      .select({ count: sql<number>`count(*)` })
      .from(pharmacyPrescriptionEvidence)
      .where(where)
      .get()?.count ?? 0
  );
  const page = clampPharmacyPage(total, input.perPage, input.page);
  const rows = db
    .select({
      id: pharmacyPrescriptionEvidence.id,
      productId: pharmacyPrescriptionEvidence.productId,
      productName: products.name,
      productClassification: pharmacyProductProfiles.classification,
      customerId: pharmacyPrescriptionEvidence.customerId,
      customerName: customers.name,
      countryCode: pharmacyPrescriptionEvidence.countryCode,
      policyVersion: pharmacyPrescriptionEvidence.policyVersion,
      authorizedQuantity: pharmacyPrescriptionEvidence.authorizedQuantity,
      dispensedQuantity: pharmacyPrescriptionEvidence.dispensedQuantity,
      validFrom: pharmacyPrescriptionEvidence.validFrom,
      expiresAt: pharmacyPrescriptionEvidence.expiresAt,
      status: pharmacyPrescriptionEvidence.status,
      approvedBy: pharmacyPrescriptionEvidence.approvedBy,
      version: pharmacyPrescriptionEvidence.version,
      createdAt: pharmacyPrescriptionEvidence.createdAt,
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
    .innerJoin(
      products,
      and(eq(products.id, pharmacyPrescriptionEvidence.productId), eq(products.tenantId, tenantId))
    )
    .leftJoin(
      pharmacyProductProfiles,
      and(
        eq(pharmacyProductProfiles.productId, pharmacyPrescriptionEvidence.productId),
        eq(pharmacyProductProfiles.tenantId, tenantId)
      )
    )
    .innerJoin(
      customers,
      and(
        eq(customers.id, pharmacyPrescriptionEvidence.customerId),
        eq(customers.tenantId, tenantId)
      )
    )
    .leftJoin(
      pharmacyProfessionalAuthorizations,
      and(
        eq(
          pharmacyProfessionalAuthorizations.id,
          pharmacyPrescriptionEvidence.approvalAuthorizationId
        ),
        eq(pharmacyProfessionalAuthorizations.tenantId, tenantId),
        eq(pharmacyProfessionalAuthorizations.userId, pharmacyPrescriptionEvidence.approvedBy),
        eq(pharmacyProfessionalAuthorizations.countryCode, pharmacyPrescriptionEvidence.countryCode)
      )
    )
    .leftJoin(
      users,
      and(eq(users.id, pharmacyProfessionalAuthorizations.userId), eq(users.tenantId, tenantId))
    )
    .where(where)
    .orderBy(desc(pharmacyPrescriptionEvidence.createdAt), desc(pharmacyPrescriptionEvidence.id))
    .limit(input.perPage)
    .offset((page - 1) * input.perPage)
    .all();
  const items = rows.map(row => {
    const {
      authorizationId,
      authorizationTenantId,
      authorizationUserId,
      authorizationUserIsActive,
      authorizationSiteId,
      authorizationCountryCode,
      authorizationCredentialType,
      authorizationCredentialDigest,
      authorizationSealedCredential,
      authorizationValidFrom,
      authorizationValidUntil,
      authorizationStatus,
      productClassification,
      ...item
    } = row;
    const authorization: PharmacyAuthorizationSnapshot | null =
      authorizationId &&
      authorizationTenantId &&
      authorizationUserId &&
      authorizationCountryCode &&
      authorizationCredentialType &&
      authorizationCredentialDigest &&
      authorizationSealedCredential &&
      authorizationValidFrom &&
      authorizationStatus
        ? {
            id: authorizationId,
            tenantId: authorizationTenantId,
            userId: authorizationUserId,
            userIsActive: authorizationUserIsActive,
            siteId: authorizationSiteId,
            countryCode: authorizationCountryCode,
            credentialType: authorizationCredentialType,
            credentialDigest: authorizationCredentialDigest,
            sealedCredential: authorizationSealedCredential,
            validFrom: authorizationValidFrom,
            validUntil: authorizationValidUntil,
            status: authorizationStatus,
          }
        : null;
    const currentPolicy = productClassification
      ? resolvePharmacyPolicy(context.countryCode, context.businessDate, productClassification)
      : null;
    return {
      ...item,
      policyMismatch:
        currentPolicy === null ||
        item.countryCode !== context.countryCode ||
        !currentPolicy.allowed ||
        !currentPolicy.evidenceRequired ||
        currentPolicy.policyVersion !== item.policyVersion,
      approvalErrorCode:
        item.status === 'approved'
          ? inspectPharmacyAuthorizationSnapshot(authorization, {
              tenantId,
              siteId: context.siteId,
              countryCode: context.countryCode,
              businessDate: context.businessDate,
            })
          : null,
    };
  });
  return { items, total, page, perPage: input.perPage };
}

export async function approvePharmacyEvidence(ctx: CriticalPharmacyContext, input: { id: string }) {
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      const evidence = tx
        .select()
        .from(pharmacyPrescriptionEvidence)
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.id, input.id),
            eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!evidence) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_EVIDENCE_NOT_FOUND',
          message: 'Prescription evidence not found',
        });
      }
      if (evidence.status === 'consumed' || evidence.status === 'revoked') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID',
          message: 'Consumed or revoked evidence cannot be approved',
        });
      }
      const previousApproval =
        evidence.status === 'approved' && evidence.approvalAuthorizationId && evidence.approvedBy
          ? tx
              .select({
                id: pharmacyProfessionalAuthorizations.id,
                tenantId: pharmacyProfessionalAuthorizations.tenantId,
                userId: pharmacyProfessionalAuthorizations.userId,
                userIsActive: users.isActive,
                siteId: pharmacyProfessionalAuthorizations.siteId,
                countryCode: pharmacyProfessionalAuthorizations.countryCode,
                credentialType: pharmacyProfessionalAuthorizations.credentialType,
                credentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
                sealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
                validFrom: pharmacyProfessionalAuthorizations.validFrom,
                validUntil: pharmacyProfessionalAuthorizations.validUntil,
                status: pharmacyProfessionalAuthorizations.status,
              })
              .from(pharmacyProfessionalAuthorizations)
              .innerJoin(
                users,
                and(
                  eq(users.id, pharmacyProfessionalAuthorizations.userId),
                  eq(users.tenantId, ctx.tenantId)
                )
              )
              .where(
                and(
                  eq(pharmacyProfessionalAuthorizations.id, evidence.approvalAuthorizationId),
                  eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId),
                  eq(pharmacyProfessionalAuthorizations.userId, evidence.approvedBy),
                  eq(pharmacyProfessionalAuthorizations.countryCode, evidence.countryCode)
                )
              )
              .get()
          : null;
      const previousApprovalError =
        evidence.status === 'approved'
          ? inspectPharmacyAuthorizationSnapshot(previousApproval ?? null, {
              tenantId: ctx.tenantId,
              siteId: ctx.siteId,
              countryCode: clock.countryCode,
              businessDate: clock.businessDate,
            })
          : null;
      if (evidence.status === 'approved' && previousApprovalError === null) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID',
          message: 'Prescription evidence already has an effective approval',
        });
      }
      const evidencePayload = requireAuthenticPharmacyPrescriptionEvidence(evidence);
      if (
        evidence.countryCode !== clock.countryCode ||
        evidence.validFrom > clock.businessDate ||
        isCalendarDateExpired(evidence.expiresAt, clock.businessDate)
      ) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_EVIDENCE_EXPIRED',
          message: 'Prescription evidence is not effective today',
        });
      }
      const medicine = getMedicineAndCustomer(
        tx,
        ctx.tenantId,
        evidence.productId,
        evidence.customerId
      );
      const currentPolicy = assertPharmacyProductPolicy({
        profile: medicine,
        countryCode: clock.countryCode,
        businessDate: clock.businessDate,
        customerId: evidence.customerId,
      });
      if (
        !currentPolicy.evidenceRequired ||
        currentPolicy.policyVersion !== evidence.policyVersion
      ) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_EVIDENCE_INVALID',
          message: 'Prescription evidence does not match the effective product policy',
        });
      }
      const missingEvidenceField = currentPolicy.requiredEvidenceFields.find(
        field => !evidencePayload[field]?.trim()
      );
      if (missingEvidenceField) {
        throwServerError({
          trpcCode: 'PRECONDITION_FAILED',
          errorCode: 'PHARMACY_EVIDENCE_INVALID',
          message: 'Prescription evidence is incomplete for the effective policy',
          details: { field: missingEvidenceField, policyVersion: currentPolicy.policyVersion },
        });
      }
      const authorization = findEffectivePharmacyAuthorization(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.user.id,
        siteId: ctx.siteId,
        countryCode: clock.countryCode,
        businessDate: clock.businessDate,
      });
      if (!authorization) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE',
          message: 'The approving user has no effective professional authorization',
        });
      }
      const update = tx
        .update(pharmacyPrescriptionEvidence)
        .set({
          status: 'approved',
          approvedBy: ctx.user.id,
          approvalAuthorizationId: authorization.id,
          version: evidence.version + 1,
          updatedAt: clock.nowIso,
        })
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.id, evidence.id),
            eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId),
            eq(pharmacyPrescriptionEvidence.status, evidence.status),
            eq(pharmacyPrescriptionEvidence.version, evidence.version)
          )
        )
        .run() as { changes?: number };
      if ((update.changes ?? 0) !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID',
          message: 'Prescription evidence changed before approval',
        });
      }
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.evidence.approve',
        resourceType: 'pharmacy_prescription_evidence',
        resourceId: evidence.id,
        before: {
          status: evidence.status,
          authorizationId: evidence.approvalAuthorizationId,
        },
        after: { status: 'approved', authorizationId: authorization.id },
        ...(evidence.status === 'approved'
          ? {
              metadata: {
                reapproval: true,
                replacedAuthorizationId: evidence.approvalAuthorizationId,
                previousApprovalError,
              },
            }
          : {}),
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(pharmacySyncContext(ctx, tx), {
        entityType: 'pharmacy_prescription_evidence',
        entityId: evidence.id,
        operation: 'update',
        data: {
          id: evidence.id,
          status: 'approved',
          approvedBy: ctx.user.id,
          approvalAuthorizationId: authorization.id,
          version: evidence.version + 1,
        },
      });
      const result = { id: evidence.id, status: 'approved' as const };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function revokePharmacyEvidence(
  ctx: CriticalPharmacyContext,
  input: { id: string; reason: string }
) {
  const now = new Date().toISOString();
  return ctx.db.transaction(
    tx => {
      const evidence = tx
        .select()
        .from(pharmacyPrescriptionEvidence)
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.id, input.id),
            eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!evidence) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_EVIDENCE_NOT_FOUND',
          message: 'Prescription evidence not found',
        });
      }
      if (evidence.status === 'consumed' || evidence.status === 'revoked') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID',
          message: 'Consumed or revoked evidence cannot be revoked again',
        });
      }
      const update = tx
        .update(pharmacyPrescriptionEvidence)
        .set({
          status: 'revoked',
          revokedBy: ctx.user.id,
          revokedAt: now,
          version: evidence.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(pharmacyPrescriptionEvidence.id, evidence.id),
            eq(pharmacyPrescriptionEvidence.tenantId, ctx.tenantId),
            eq(pharmacyPrescriptionEvidence.version, evidence.version)
          )
        )
        .run() as { changes?: number };
      if ((update.changes ?? 0) !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_EVIDENCE_STATE_INVALID',
          message: 'Prescription evidence changed before revocation',
        });
      }
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.evidence.revoke',
        resourceType: 'pharmacy_prescription_evidence',
        resourceId: evidence.id,
        before: { status: evidence.status },
        after: { status: 'revoked' },
        metadata: { reason: input.reason },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(pharmacySyncContext(ctx, tx), {
        entityType: 'pharmacy_prescription_evidence',
        entityId: evidence.id,
        operation: 'update',
        data: { id: evidence.id, status: 'revoked', revokedAt: now },
      });
      const result = { id: evidence.id, status: 'revoked' as const };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
