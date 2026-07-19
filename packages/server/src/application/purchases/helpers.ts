/**
 * Purchase shared helpers (validation, site/sequential/balance context, notes).
 *
 * ENG-178 — extracted verbatim from the former monolithic
 * `trpc/routers/purchases.ts` during the megafile decomposition. The `db`
 * parameters are typed `DatabaseInstance` (the standalone DB type) rather
 * than `Context['db']` so the application layer stays decoupled from the
 * tRPC context — the underlying type is identical.
 *
 * @module application/purchases/helpers
 */
import { TRPCError } from '@trpc/server';
import { normalizedQuantity as resolveNormalizedQuantity } from '@puntovivo/shared/unit-math';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { inventoryBalances, providers, sequentials, sites } from '../../db/schema.js';
import { ensureInventoryBalancesForSite } from '../../services/inventory-balances.js';
import type { PurchaseSequentialContext, PurchaseSiteContext } from './types.js';

export function buildVoidedPurchaseNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return `${existingNotes ? `${existingNotes} | ` : ''}Voided`;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Voided: ${reason}`;
}

export function buildReturnedPurchaseNotes(existingNotes: string | null, reason: string | undefined) {
  if (!reason) {
    return existingNotes;
  }

  return `${existingNotes ? `${existingNotes} | ` : ''}Returned: ${reason}`;
}

export function getNormalizedPurchaseQuantity(quantity: number, equivalence: number) {
  try {
    return resolveNormalizedQuantity(quantity, equivalence);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The selected quantity must resolve to a positive stock quantity',
    });
  }
}

export async function getPurchaseSiteContext(
  db: DatabaseInstance,
  tenantId: string,
  preferredSiteId: string | null,
  fallbackSiteId: string
): Promise<PurchaseSiteContext> {
  const resolvedSiteId = preferredSiteId ?? fallbackSiteId;
  const site = await db
    .select({
      id: sites.id,
      name: sites.name,
      isActive: sites.isActive,
    })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.id, resolvedSiteId)))
    .get();

  if (!site || site.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected purchase site was not found or is inactive',
    });
  }

  return {
    id: site.id,
    name: site.name,
  };
}

export async function getInventoryBalanceStateForSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  productIds: string[]
) {
  if (productIds.length === 0) {
    return new Map<string, number>();
  }

  ensureInventoryBalancesForSite(db, tenantId, siteId);

  const balances = await db
    .select({
      productId: inventoryBalances.productId,
      onHand: inventoryBalances.onHand,
    })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        inArray(inventoryBalances.productId, productIds)
      )
    )
    .all();

  return new Map(balances.map(balance => [balance.productId, balance.onHand]));
}

export async function getPurchaseSequentialContext(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string | null
): Promise<PurchaseSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'purchase'),
    eq(sites.isActive, true),
  ];

  if (siteId) {
    const siteScopedSequential = await db
      .select({
        id: sequentials.id,
        prefix: sequentials.prefix,
        currentValue: sequentials.currentValue,
        siteId: sequentials.siteId,
        siteName: sites.name,
      })
      .from(sequentials)
      .innerJoin(sites, eq(sequentials.siteId, sites.id))
      .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
      .get();

    if (siteScopedSequential) {
      return siteScopedSequential;
    }
  }

  const fallbackSequential = await db
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
      siteId: sequentials.siteId,
      siteName: sites.name,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.name))
    .get();

  if (!fallbackSequential) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No active purchase sequential is configured for the current tenant',
    });
  }

  return fallbackSequential;
}

export async function validateProvider(db: DatabaseInstance, tenantId: string, providerId: string) {
  const provider = await db
    .select({ id: providers.id, isActive: providers.isActive })
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.tenantId, tenantId)))
    .get();

  if (!provider || provider.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected provider was not found or is inactive',
    });
  }
}
