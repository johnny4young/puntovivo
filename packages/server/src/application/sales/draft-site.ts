/**
 * Resolve the durable site evidence carried by an existing sale draft.
 *
 * A selected destination table and the caller's current-site header are not
 * provenance: neither proves where stock was reserved. Only state already
 * attached to the draft may establish that fact. Every caller must run this
 * helper again inside its IMMEDIATE writer before changing that state.
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  restaurantChecks,
  restaurantServices,
  restaurantTables,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

/** Persisted sale anchors accepted by the provenance resolver. */
export interface DraftSiteEvidenceInput {
  saleId: string;
  cashSessionId: string | null;
  tableId: string | null;
}

/** Open normalized check metadata that authorizes a restaurant handoff. */
export interface OpenRestaurantDraftContext {
  checkId: string;
  serviceId: string;
  siteId: string;
  tableId: string;
  openedBy: string;
}

/** Cross-checked site provenance for a persisted draft sale. */
export interface DraftSiteEvidence {
  siteId: string | null;
  restaurant: OpenRestaurantDraftContext | null;
}

/**
 * Resolve and cross-check cash-session, normalized-service and current-table
 * site anchors for one tenant-scoped draft. Missing or contradictory anchors
 * fail closed instead of falling back to the destination or UI context.
 */
export function resolveDraftSiteEvidence(
  db: DatabaseInstance,
  tenantId: string,
  input: DraftSiteEvidenceInput
): DraftSiteEvidence {
  const session = input.cashSessionId
    ? db
        .select({ siteId: cashSessions.siteId })
        .from(cashSessions)
        .where(and(eq(cashSessions.id, input.cashSessionId), eq(cashSessions.tenantId, tenantId)))
        .get()
    : null;
  if (input.cashSessionId && !session) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
      message: 'The draft cash-session site can no longer be verified',
      details: { saleId: input.saleId, cashSessionId: input.cashSessionId },
    });
  }

  const restaurantRow = db
    .select({
      checkId: restaurantChecks.id,
      checkStatus: restaurantChecks.status,
      serviceId: restaurantServices.id,
      serviceStatus: restaurantServices.status,
      siteId: restaurantServices.siteId,
      tableId: restaurantServices.tableId,
      openedBy: restaurantChecks.openedBy,
    })
    .from(restaurantChecks)
    .innerJoin(
      restaurantServices,
      and(
        eq(restaurantServices.id, restaurantChecks.serviceId),
        eq(restaurantServices.tenantId, tenantId)
      )
    )
    .where(and(eq(restaurantChecks.tenantId, tenantId), eq(restaurantChecks.saleId, input.saleId)))
    .get();
  if (
    restaurantRow &&
    (restaurantRow.checkStatus !== 'open' || restaurantRow.serviceStatus !== 'open')
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'A draft sale is attached to a closed restaurant check or service',
      details: { saleId: input.saleId },
    });
  }

  const table = input.tableId
    ? db
        .select({ siteId: restaurantTables.siteId })
        .from(restaurantTables)
        .where(and(eq(restaurantTables.id, input.tableId), eq(restaurantTables.tenantId, tenantId)))
        .get()
    : null;
  if (input.tableId && !table) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_DRAFT_SITE_UNKNOWN',
      message: 'The draft table site can no longer be verified',
      details: { saleId: input.saleId, tableId: input.tableId },
    });
  }
  if (restaurantRow && input.tableId !== restaurantRow.tableId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'The draft table does not match its normalized restaurant service',
      details: {
        saleId: input.saleId,
        saleTableId: input.tableId,
        serviceTableId: restaurantRow.tableId,
      },
    });
  }

  const siteIds = [session?.siteId, restaurantRow?.siteId, table?.siteId].filter(
    (siteId): siteId is string => typeof siteId === 'string' && siteId.length > 0
  );
  const distinctSiteIds = [...new Set(siteIds)];
  if (distinctSiteIds.length > 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_DRAFT_SITE_MISMATCH',
      message: 'Draft site evidence is inconsistent',
      details: { saleId: input.saleId, siteIds: distinctSiteIds },
    });
  }

  return {
    siteId: distinctSiteIds[0] ?? null,
    restaurant: restaurantRow
      ? {
          checkId: restaurantRow.checkId,
          serviceId: restaurantRow.serviceId,
          siteId: restaurantRow.siteId,
          tableId: restaurantRow.tableId,
          openedBy: restaurantRow.openedBy,
        }
      : null,
  };
}

/** A cross-operator cashier handoff is valid only for an open check at the active site. */
export function isSameSiteRestaurantHandoff(
  evidence: DraftSiteEvidence,
  activeSiteId: string | null | undefined
): boolean {
  return Boolean(
    activeSiteId && evidence.restaurant && evidence.restaurant.siteId === activeSiteId
  );
}
