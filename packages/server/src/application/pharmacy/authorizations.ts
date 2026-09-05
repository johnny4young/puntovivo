import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { pharmacyProfessionalAuthorizations, sites, users } from '../../db/schema.js';
import { ServerErrorWithCode, throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  digestPharmacyReference,
  hasPharmacyEvidenceKey,
  sealPharmacyEvidence,
} from '../../services/pharmacy/evidence-box.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
} from '../../services/pharmacy/business-clock.js';
import { requireAuthenticPharmacyProfessionalCredential } from '../../services/pharmacy/evidence-integrity.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { CreatePharmacyAuthorizationInput } from '../../trpc/schemas/pharmacy.js';
import { clampPharmacyPage, pharmacySyncContext, type CriticalPharmacyContext } from './types.js';

export interface EffectivePharmacyAuthorization {
  id: string;
  userId: string;
  siteId: string | null;
  countryCode: string;
  validFrom: string;
  validUntil: string | null;
}

export type PharmacyApprovalCapabilityErrorCode =
  'PHARMACY_AUTHORIZATION_INVALID' | 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE';

export type PharmacyAuthorizationUsabilityErrorCode =
  PharmacyApprovalCapabilityErrorCode | 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE';

export interface PharmacyAuthorizationSnapshot {
  id: string;
  tenantId: string;
  userId: string;
  userIsActive: boolean | null;
  siteId: string | null;
  countryCode: string;
  credentialType: string;
  credentialDigest: string;
  sealedCredential: string;
  validFrom: string;
  validUntil: string | null;
  status: 'active' | 'revoked';
}

export interface PharmacyApprovalCapability {
  authorization: EffectivePharmacyAuthorization | null;
  errorCode: PharmacyApprovalCapabilityErrorCode | null;
}

function getApprovalCredentialErrorCode(
  error: unknown
): PharmacyApprovalCapabilityErrorCode | null {
  const errorCode =
    error instanceof TRPCError && error.cause instanceof ServerErrorWithCode
      ? error.cause.errorCode
      : null;
  return errorCode === 'PHARMACY_AUTHORIZATION_INVALID' ||
    errorCode === 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE'
    ? errorCode
    : null;
}

/**
 * Inspect the exact authorization frozen on an evidence row. A stale or
 * corrupt approval is recoverable only through an explicit re-approval by a
 * currently authorized employee; callers must never silently substitute a
 * newer authorization for the stored decision.
 */
export function inspectPharmacyAuthorizationSnapshot(
  authorization: PharmacyAuthorizationSnapshot | null,
  args: {
    tenantId: string;
    siteId: string | null;
    countryCode: string;
    businessDate: string;
  }
): PharmacyAuthorizationUsabilityErrorCode | null {
  if (
    !authorization ||
    authorization.tenantId !== args.tenantId ||
    authorization.countryCode !== args.countryCode ||
    authorization.status !== 'active' ||
    !authorization.userIsActive ||
    authorization.validFrom > args.businessDate ||
    (authorization.validUntil !== null && authorization.validUntil < args.businessDate) ||
    (authorization.siteId !== null && authorization.siteId !== args.siteId)
  ) {
    return 'PHARMACY_AUTHORIZATION_NOT_EFFECTIVE';
  }

  try {
    requireAuthenticPharmacyProfessionalCredential(authorization);
    return null;
  } catch (error) {
    const errorCode = getApprovalCredentialErrorCode(error);
    if (errorCode) return errorCode;
    throw error;
  }
}

export function findEffectivePharmacyAuthorization(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    userId: string;
    siteId: string | null;
    countryCode: string;
    businessDate: string;
  }
): EffectivePharmacyAuthorization | null {
  const authorization = db
    .select({
      id: pharmacyProfessionalAuthorizations.id,
      tenantId: pharmacyProfessionalAuthorizations.tenantId,
      userId: pharmacyProfessionalAuthorizations.userId,
      siteId: pharmacyProfessionalAuthorizations.siteId,
      countryCode: pharmacyProfessionalAuthorizations.countryCode,
      credentialType: pharmacyProfessionalAuthorizations.credentialType,
      credentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
      sealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
      validFrom: pharmacyProfessionalAuthorizations.validFrom,
      validUntil: pharmacyProfessionalAuthorizations.validUntil,
    })
    .from(pharmacyProfessionalAuthorizations)
    .innerJoin(
      users,
      and(
        eq(users.id, pharmacyProfessionalAuthorizations.userId),
        eq(users.tenantId, args.tenantId),
        eq(users.isActive, true)
      )
    )
    .where(
      and(
        eq(pharmacyProfessionalAuthorizations.tenantId, args.tenantId),
        eq(pharmacyProfessionalAuthorizations.userId, args.userId),
        eq(pharmacyProfessionalAuthorizations.countryCode, args.countryCode),
        eq(pharmacyProfessionalAuthorizations.status, 'active'),
        lte(pharmacyProfessionalAuthorizations.validFrom, args.businessDate),
        or(
          isNull(pharmacyProfessionalAuthorizations.validUntil),
          gte(pharmacyProfessionalAuthorizations.validUntil, args.businessDate)
        ),
        args.siteId
          ? or(
              isNull(pharmacyProfessionalAuthorizations.siteId),
              eq(pharmacyProfessionalAuthorizations.siteId, args.siteId)
            )
          : isNull(pharmacyProfessionalAuthorizations.siteId)
      )
    )
    .orderBy(
      // A site-scoped credential is the narrowest authority and must win over
      // a tenant-wide credential at that site. The remaining keys make ties
      // deterministic without silently skipping a newer corrupt credential.
      desc(
        sql<number>`case when ${pharmacyProfessionalAuthorizations.siteId} is null then 0 else 1 end`
      ),
      desc(pharmacyProfessionalAuthorizations.validFrom),
      desc(pharmacyProfessionalAuthorizations.createdAt),
      desc(pharmacyProfessionalAuthorizations.id)
    )
    .get();
  if (!authorization) return null;
  requireAuthenticPharmacyProfessionalCredential(authorization);
  return {
    id: authorization.id,
    userId: authorization.userId,
    siteId: authorization.siteId,
    countryCode: authorization.countryCode,
    validFrom: authorization.validFrom,
    validUntil: authorization.validUntil,
  };
}

/**
 * Inspect approval capability without taking unrelated custody and recall UI
 * offline when the current employee's credential is corrupt. Irreversible
 * approval and checkout paths continue to call the throwing resolver above.
 */
export function inspectPharmacyApprovalCapability(
  db: DatabaseInstance,
  args: Parameters<typeof findEffectivePharmacyAuthorization>[1]
): PharmacyApprovalCapability {
  try {
    return {
      authorization: findEffectivePharmacyAuthorization(db, args),
      errorCode: null,
    };
  } catch (error) {
    const errorCode = getApprovalCredentialErrorCode(error);
    if (errorCode) {
      return { authorization: null, errorCode };
    }
    throw error;
  }
}

function assertSecretKey(): void {
  if (!hasPharmacyEvidenceKey()) {
    throwServerError({
      trpcCode: 'PRECONDITION_FAILED',
      errorCode: 'PHARMACY_EVIDENCE_KEY_UNAVAILABLE',
      message: 'Pharmacy secret protection is unavailable',
    });
  }
}

export async function createPharmacyAuthorization(
  ctx: CriticalPharmacyContext,
  input: CreatePharmacyAuthorizationInput
) {
  assertSecretKey();
  const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  if (input.countryCode !== clock.countryCode) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_AUTHORIZATION_SUBJECT_INVALID',
      message: 'Authorization country must match the tenant country',
    });
  }

  const id = nanoid();
  const digest = digestPharmacyReference(input.credential, {
    purpose: 'professional-credential',
    tenantId: ctx.tenantId,
    subjectId: input.countryCode,
  });
  const legacyDigest = digestPharmacyReference(input.credential, 'professional-credential');
  const sealedCredential = sealPharmacyEvidence(
    { reference: input.credential, notes: input.credentialType },
    {
      purpose: 'professional-credential',
      tenantId: ctx.tenantId,
      subjectId: id,
    }
  );

  return ctx.db.transaction(
    tx => {
      assertTenantBusinessClockCurrent(tx, ctx.tenantId, clock);
      const subject = tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.tenantId, ctx.tenantId),
            eq(users.isActive, true)
          )
        )
        .get();
      const site = input.siteId
        ? tx
            .select({ id: sites.id })
            .from(sites)
            .where(
              and(
                eq(sites.id, input.siteId),
                eq(sites.tenantId, ctx.tenantId),
                eq(sites.isActive, true)
              )
            )
            .get()
        : { id: null };
      if (!subject || !site) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PHARMACY_AUTHORIZATION_SUBJECT_INVALID',
          message: 'Authorization subject or site is invalid',
        });
      }
      const credentialRows = tx
        .select({ userId: pharmacyProfessionalAuthorizations.userId })
        .from(pharmacyProfessionalAuthorizations)
        .where(
          and(
            eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyProfessionalAuthorizations.countryCode, input.countryCode),
            inArray(pharmacyProfessionalAuthorizations.credentialDigest, [digest, legacyDigest])
          )
        )
        .all();
      if (credentialRows.some(row => row.userId !== input.userId)) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_AUTHORIZATION_SUBJECT_INVALID',
          message: 'Professional credential is already bound to another employee',
        });
      }

      const overlappingAuthorization = tx
        .select({ id: pharmacyProfessionalAuthorizations.id })
        .from(pharmacyProfessionalAuthorizations)
        .where(
          and(
            eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyProfessionalAuthorizations.countryCode, input.countryCode),
            inArray(pharmacyProfessionalAuthorizations.credentialDigest, [digest, legacyDigest]),
            eq(pharmacyProfessionalAuthorizations.status, 'active'),
            input.siteId
              ? or(
                  isNull(pharmacyProfessionalAuthorizations.siteId),
                  eq(pharmacyProfessionalAuthorizations.siteId, input.siteId)
                )
              : undefined,
            input.validUntil
              ? lte(pharmacyProfessionalAuthorizations.validFrom, input.validUntil)
              : undefined,
            or(
              isNull(pharmacyProfessionalAuthorizations.validUntil),
              gte(pharmacyProfessionalAuthorizations.validUntil, input.validFrom)
            )
          )
        )
        .get();
      if (overlappingAuthorization) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_AUTHORIZATION_DUPLICATE',
          message: 'Professional credential already has an overlapping active authorization',
        });
      }

      tx.insert(pharmacyProfessionalAuthorizations)
        .values({
          id,
          tenantId: ctx.tenantId,
          userId: input.userId,
          siteId: input.siteId ?? null,
          countryCode: input.countryCode,
          credentialType: input.credentialType,
          credentialDigest: digest,
          sealedCredential,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          status: 'active',
          version: 0,
          createdBy: ctx.user.id,
          createdAt: clock.nowIso,
          updatedAt: clock.nowIso,
        })
        .run();

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.authorization.create',
        resourceType: 'pharmacy_authorization',
        resourceId: id,
        before: null,
        after: {
          userId: input.userId,
          siteId: input.siteId ?? null,
          countryCode: input.countryCode,
          credentialType: input.credentialType,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          status: 'active',
        },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(pharmacySyncContext(ctx, tx), {
        entityType: 'pharmacy_professional_authorizations',
        entityId: id,
        operation: 'create',
        data: {
          // The generic sync queue is operator-visible and has no regulated
          // key-exchange codec. Keep the authoritative ciphertext only in
          // the pharmacy table until atomic encrypted replication exists.
          id,
          userId: input.userId,
          siteId: input.siteId ?? null,
          countryCode: input.countryCode,
          credentialType: input.credentialType,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          status: 'active',
        },
      });
      const result = { id, status: 'active' as const };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}

export function listPharmacyAuthorizations(
  db: DatabaseInstance,
  tenantId: string,
  input?: {
    userId?: string | undefined;
    siteId?: string | undefined;
    activeOnly?: boolean | undefined;
    page?: number | undefined;
    perPage?: number | undefined;
  }
) {
  const filters = [eq(pharmacyProfessionalAuthorizations.tenantId, tenantId)];
  if (input?.userId) filters.push(eq(pharmacyProfessionalAuthorizations.userId, input.userId));
  if (input?.siteId) filters.push(eq(pharmacyProfessionalAuthorizations.siteId, input.siteId));
  if (input?.activeOnly ?? true)
    filters.push(eq(pharmacyProfessionalAuthorizations.status, 'active'));
  const where = and(...filters);
  const perPage = input?.perPage ?? 50;
  const total = Number(
    db
      .select({ count: sql<number>`count(*)` })
      .from(pharmacyProfessionalAuthorizations)
      .where(where)
      .get()?.count ?? 0
  );
  const page = clampPharmacyPage(total, perPage, input?.page ?? 1);
  const items = db
    .select({
      id: pharmacyProfessionalAuthorizations.id,
      userId: pharmacyProfessionalAuthorizations.userId,
      userName: users.name,
      userIsActive: users.isActive,
      siteId: pharmacyProfessionalAuthorizations.siteId,
      siteName: sites.name,
      countryCode: pharmacyProfessionalAuthorizations.countryCode,
      credentialType: pharmacyProfessionalAuthorizations.credentialType,
      validFrom: pharmacyProfessionalAuthorizations.validFrom,
      validUntil: pharmacyProfessionalAuthorizations.validUntil,
      status: pharmacyProfessionalAuthorizations.status,
      version: pharmacyProfessionalAuthorizations.version,
      createdAt: pharmacyProfessionalAuthorizations.createdAt,
    })
    .from(pharmacyProfessionalAuthorizations)
    .innerJoin(
      users,
      and(eq(users.id, pharmacyProfessionalAuthorizations.userId), eq(users.tenantId, tenantId))
    )
    .leftJoin(
      sites,
      and(eq(sites.id, pharmacyProfessionalAuthorizations.siteId), eq(sites.tenantId, tenantId))
    )
    .where(where)
    .orderBy(
      desc(pharmacyProfessionalAuthorizations.createdAt),
      desc(pharmacyProfessionalAuthorizations.id)
    )
    .limit(perPage)
    .offset((page - 1) * perPage)
    .all();
  return { items, total, page, perPage };
}

export function revokePharmacyAuthorization(
  ctx: CriticalPharmacyContext,
  input: { id: string; reason: string }
) {
  const now = new Date().toISOString();
  return ctx.db.transaction(
    tx => {
      const existing = tx
        .select()
        .from(pharmacyProfessionalAuthorizations)
        .where(
          and(
            eq(pharmacyProfessionalAuthorizations.id, input.id),
            eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId)
          )
        )
        .get();
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'PHARMACY_AUTHORIZATION_NOT_FOUND',
          message: 'Professional authorization not found',
        });
      }
      if (existing.status === 'revoked') {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_AUTHORIZATION_STATE_INVALID',
          message: 'Professional authorization is already revoked',
        });
      }
      const changed = tx
        .update(pharmacyProfessionalAuthorizations)
        .set({
          status: 'revoked',
          revokedBy: ctx.user.id,
          revokedAt: now,
          updatedAt: now,
          version: existing.version + 1,
        })
        .where(
          and(
            eq(pharmacyProfessionalAuthorizations.id, existing.id),
            eq(pharmacyProfessionalAuthorizations.tenantId, ctx.tenantId),
            eq(pharmacyProfessionalAuthorizations.version, existing.version)
          )
        )
        .run() as { changes?: number };
      if ((changed.changes ?? 0) !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PHARMACY_AUTHORIZATION_STATE_INVALID',
          message: 'Professional authorization changed before revocation',
        });
      }
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'pharmacy.authorization.revoke',
        resourceType: 'pharmacy_authorization',
        resourceId: existing.id,
        before: { status: existing.status },
        after: { status: 'revoked' },
        metadata: { reason: input.reason },
        operationId: ctx.envelope.operationId,
      });
      enqueueSyncInTransaction(pharmacySyncContext(ctx, tx), {
        entityType: 'pharmacy_professional_authorizations',
        entityId: existing.id,
        operation: 'update',
        data: { id: existing.id, status: 'revoked', revokedAt: now },
      });
      const result = { id: existing.id, status: 'revoked' as const };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
