/**
 * Site quick keys: the one-touch strip every register of a site shares.
 * Managers choose and order the keys; registers read them; a browser's old
 * local favourites can seed a site that has none yet.
 *
 * @module services/site-quick-keys
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../db/index.js';
import {
  MAX_SITE_QUICK_KEYS,
  products,
  SITE_QUICK_KEY_COLOURS,
  siteQuickKeys,
  unitXProduct,
  units,
  type SiteQuickKeyColour,
  type SiteQuickKeyKind,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

type Transaction = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];
type Reader = DatabaseInstance | Transaction;

export interface SiteQuickKeyScope {
  tenantId: string;
  siteId: string;
  userId: string;
}

export interface SiteQuickKeyInput {
  id?: string | undefined;
  kind: SiteQuickKeyKind;
  productId: string;
  unitId?: string | null | undefined;
  label?: string | null | undefined;
  colour?: SiteQuickKeyColour | null | undefined;
}

export interface SiteQuickKeyRow {
  id: string;
  position: number;
  kind: SiteQuickKeyKind;
  productId: string;
  productName: string;
  productSku: string;
  categoryId: string | null;
  /** False for inactive products and matrix parents; registers hide those keys. */
  sellable: boolean;
  /** Null when the key sells the base unit or its unit left the product. */
  unitId: string | null;
  unitAbbreviation: string | null;
  label: string | null;
  colour: SiteQuickKeyColour | null;
  /** Catalog price of the key's unit, or of the product for the base unit. */
  catalogPrice: number;
}

const inSite = (tenantId: string, siteId: string) =>
  and(eq(siteQuickKeys.tenantId, tenantId), eq(siteQuickKeys.siteId, siteId));

const isSellable = (product: { isActive: boolean | null; catalogType: string }) =>
  product.isActive !== false && product.catalogType !== 'variant_parent';

export function listSiteQuickKeys(db: Reader, tenantId: string, siteId: string): SiteQuickKeyRow[] {
  const rows = db
    .select({
      id: siteQuickKeys.id,
      position: siteQuickKeys.position,
      kind: siteQuickKeys.kind,
      productId: siteQuickKeys.productId,
      productName: products.name,
      productSku: products.sku,
      categoryId: products.categoryId,
      isActive: products.isActive,
      catalogType: products.catalogType,
      productPrice: products.price,
      unitId: unitXProduct.unitId,
      unitAbbreviation: units.abbreviation,
      unitPrice: unitXProduct.price,
      label: siteQuickKeys.label,
      colour: siteQuickKeys.colour,
    })
    .from(siteQuickKeys)
    .innerJoin(
      products,
      and(eq(products.id, siteQuickKeys.productId), eq(products.tenantId, tenantId))
    )
    .leftJoin(
      unitXProduct,
      and(
        eq(unitXProduct.productId, siteQuickKeys.productId),
        eq(unitXProduct.unitId, siteQuickKeys.unitId)
      )
    )
    .leftJoin(units, and(eq(units.id, unitXProduct.unitId), eq(units.tenantId, tenantId)))
    .where(inSite(tenantId, siteId))
    .orderBy(asc(siteQuickKeys.position))
    .all();

  return rows.map(row => ({
    id: row.id,
    position: row.position,
    kind: row.kind,
    productId: row.productId,
    productName: row.productName,
    productSku: row.productSku,
    categoryId: row.categoryId,
    sellable: isSellable(row),
    unitId: row.unitId,
    unitAbbreviation: row.unitAbbreviation,
    label: row.label,
    colour: row.colour,
    catalogPrice: row.unitPrice ?? row.productPrice,
  }));
}

function assertSellableProduct(
  db: Reader,
  tenantId: string,
  productId: string,
  unitId: string | null
): void {
  const product = db
    .select({ isActive: products.isActive, catalogType: products.catalogType })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .get();
  if (!product || !isSellable(product)) {
    throwServerError({
      trpcCode: product ? 'BAD_REQUEST' : 'NOT_FOUND',
      errorCode: 'QUICK_KEY_PRODUCT_INVALID',
      message: 'This product cannot be a quick key',
    });
  }
  if (!unitId) return;
  const assignment = db
    .select({ id: unitXProduct.id })
    .from(unitXProduct)
    .where(and(eq(unitXProduct.productId, productId), eq(unitXProduct.unitId, unitId)))
    .get();
  if (!assignment) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'QUICK_KEY_UNIT_INVALID',
      message: 'The product is not sold in this unit',
    });
  }
}

function siteKeys(tx: Reader, tenantId: string, siteId: string) {
  return tx
    .select({
      id: siteQuickKeys.id,
      position: siteQuickKeys.position,
      kind: siteQuickKeys.kind,
      productId: siteQuickKeys.productId,
      unitId: siteQuickKeys.unitId,
      colour: siteQuickKeys.colour,
    })
    .from(siteQuickKeys)
    .where(inSite(tenantId, siteId))
    .orderBy(asc(siteQuickKeys.position))
    .all();
}

/** First swatch no key of the site uses yet; a site has fewer keys than swatches. */
function nextColour(used: readonly (SiteQuickKeyColour | null)[]): SiteQuickKeyColour {
  return SITE_QUICK_KEY_COLOURS.find(colour => !used.includes(colour)) ?? SITE_QUICK_KEY_COLOURS[0];
}

/** Writes only the keys whose position changed. */
function writePositions(
  tx: Transaction,
  scope: SiteQuickKeyScope,
  keys: readonly { id: string; position: number }[],
  order: readonly string[]
) {
  const now = new Date().toISOString();
  const current = new Map(keys.map(key => [key.id, key.position]));
  order.forEach((id, position) => {
    if (current.get(id) === position) return;
    tx.update(siteQuickKeys)
      .set({ position, updatedAt: now, updatedBy: scope.userId })
      .where(and(eq(siteQuickKeys.id, id), inSite(scope.tenantId, scope.siteId)))
      .run();
  });
}

/**
 * Creates a key at the end of the strip, or updates one when `id` is given.
 * Returns the site's keys in order, like every other edit.
 */
export function setSiteQuickKey(
  db: DatabaseInstance,
  scope: SiteQuickKeyScope,
  input: SiteQuickKeyInput
): SiteQuickKeyRow[] {
  const unitId = input.unitId ?? null;
  const label = input.label?.trim() || null;

  db.transaction(tx => {
    assertSellableProduct(tx, scope.tenantId, input.productId, unitId);
    const keys = siteKeys(tx, scope.tenantId, scope.siteId);
    const duplicate = keys.find(
      key =>
        key.id !== input.id &&
        key.kind === input.kind &&
        key.productId === input.productId &&
        key.unitId === unitId
    );
    if (duplicate) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'QUICK_KEY_DUPLICATE',
        message: 'This key already exists',
      });
    }

    if (input.id) {
      const existing = keys.find(key => key.id === input.id);
      if (!existing) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'QUICK_KEY_NOT_FOUND',
          message: 'Quick key not found',
        });
      }
      tx.update(siteQuickKeys)
        .set({
          kind: input.kind,
          productId: input.productId,
          unitId,
          label,
          colour: input.colour === undefined ? existing.colour : input.colour,
          updatedAt: new Date().toISOString(),
          updatedBy: scope.userId,
        })
        .where(eq(siteQuickKeys.id, existing.id))
        .run();
      return;
    }

    if (keys.length >= MAX_SITE_QUICK_KEYS) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUICK_KEY_LIMIT_REACHED',
        message: `A site can have at most ${MAX_SITE_QUICK_KEYS} quick keys`,
        details: { max: MAX_SITE_QUICK_KEYS },
      });
    }
    tx.insert(siteQuickKeys)
      .values({
        id: nanoid(),
        tenantId: scope.tenantId,
        siteId: scope.siteId,
        position: keys.length,
        kind: input.kind,
        productId: input.productId,
        unitId,
        label,
        colour: input.colour ?? nextColour(keys.map(key => key.colour)),
        createdBy: scope.userId,
        updatedBy: scope.userId,
      })
      .run();
  });

  return listSiteQuickKeys(db, scope.tenantId, scope.siteId);
}

/** `ids` must list every key of the site exactly once, in the new order. */
export function reorderSiteQuickKeys(
  db: DatabaseInstance,
  scope: SiteQuickKeyScope,
  ids: readonly string[]
): SiteQuickKeyRow[] {
  db.transaction(tx => {
    const keys = siteKeys(tx, scope.tenantId, scope.siteId);
    const sameSet =
      ids.length === keys.length &&
      new Set(ids).size === ids.length &&
      keys.every(key => ids.includes(key.id));
    if (!sameSet) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'QUICK_KEY_ORDER_INVALID',
        message: 'The new order must list every key of the site once',
      });
    }
    writePositions(tx, scope, keys, ids);
  });
  return listSiteQuickKeys(db, scope.tenantId, scope.siteId);
}

export function removeSiteQuickKey(
  db: DatabaseInstance,
  scope: SiteQuickKeyScope,
  id: string
): SiteQuickKeyRow[] {
  db.transaction(tx => {
    const deleted = tx
      .delete(siteQuickKeys)
      .where(and(eq(siteQuickKeys.id, id), inSite(scope.tenantId, scope.siteId)))
      .returning({ position: siteQuickKeys.position })
      .get();
    if (!deleted) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'QUICK_KEY_NOT_FOUND',
        message: 'Quick key not found',
      });
    }
    tx.update(siteQuickKeys)
      .set({
        position: sql`${siteQuickKeys.position} - 1`,
        updatedAt: new Date().toISOString(),
        updatedBy: scope.userId,
      })
      .where(
        and(inSite(scope.tenantId, scope.siteId), gt(siteQuickKeys.position, deleted.position))
      )
      .run();
  });
  return listSiteQuickKeys(db, scope.tenantId, scope.siteId);
}

/**
 * Seeds an empty site with a browser's former local favourites. Does nothing
 * once the site has keys, so every register can call it safely. Returns the
 * site's keys either way.
 */
export function importLocalFavourites(
  db: DatabaseInstance,
  scope: SiteQuickKeyScope,
  productIds: readonly string[]
): SiteQuickKeyRow[] {
  db.transaction(tx => {
    if (siteKeys(tx, scope.tenantId, scope.siteId).length > 0) return;
    const requested = [...new Set(productIds)];
    if (requested.length === 0) return;
    const sellable = new Set(
      tx
        .select({ id: products.id, isActive: products.isActive, catalogType: products.catalogType })
        .from(products)
        .where(and(eq(products.tenantId, scope.tenantId), inArray(products.id, requested)))
        .all()
        .filter(isSellable)
        .map(product => product.id)
    );
    const accepted = requested.filter(id => sellable.has(id)).slice(0, MAX_SITE_QUICK_KEYS);
    if (accepted.length === 0) return;
    tx.insert(siteQuickKeys)
      .values(
        accepted.map((productId, position) => ({
          id: nanoid(),
          tenantId: scope.tenantId,
          siteId: scope.siteId,
          position,
          kind: 'product' as const,
          productId,
          colour: SITE_QUICK_KEY_COLOURS[position],
          createdBy: scope.userId,
          updatedBy: scope.userId,
        }))
      )
      .run();
  });
  return listSiteQuickKeys(db, scope.tenantId, scope.siteId);
}
