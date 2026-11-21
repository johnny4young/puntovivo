/**
 * Till incidents: a cashier flags a stockout, a shelf price that differs from
 * the system price, or a product without a barcode, and keeps selling. The
 * open rows feed the manager's pending queue until someone resolves them; a
 * repeat report of an open incident returns the existing row.
 *
 * @module services/register-incidents
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../db/index.js';
import {
  cashSessions,
  products,
  registerIncidents,
  sites,
  users,
  type RegisterIncidentKind,
  type RegisterIncidentReason,
} from '../db/schema.js';
import { getActiveCashSessionForCashier } from './cash-session/queries.js';
import { resolveTenantBusinessClock } from './pharmacy/business-clock.js';
import { resolveUtcDayWindow } from './reports/day-window.js';
import {
  getStockBySite,
  withSiteStockBreakdown,
  type SiteStock,
} from './inventory-balances/site-stock.js';

export interface ReportRegisterIncidentInput {
  kind: RegisterIncidentKind;
  productId?: string | undefined;
  reason?: RegisterIncidentReason | undefined;
  shelfPrice?: number | undefined;
  note?: string | undefined;
}

export interface RegisterIncidentRow {
  id: string;
  siteId: string;
  siteName: string;
  kind: RegisterIncidentKind;
  reason: RegisterIncidentReason | null;
  productId: string | null;
  productName: string | null;
  shelfPrice: number | null;
  systemPrice: number | null;
  note: string | null;
  reportedBy: string;
  reportedByName: string;
  createdAt: string;
  /** On-hand per site for the product, so the manager sees where to transfer from. */
  stockBySite: SiteStock[];
}

function findTenantProduct(db: DatabaseInstance, tenantId: string, productId: string) {
  const product = db
    .select({ id: products.id, name: products.name, price: products.price })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, tenantId)))
    .get();
  if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
  return product;
}

// Rows written by the SQLite column default lack the ISO "T" and "Z"; read and compare one shape.
const createdInstant = sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ', ${registerIncidents.createdAt})`;

/** The raw-column range keeps the index usable and holds both shapes; the instant decides. */
function createdInBusinessDay(day: { startIso: string; endExclusiveIso: string }) {
  return and(
    gte(registerIncidents.createdAt, day.startIso.slice(0, 10)),
    lt(registerIncidents.createdAt, day.endExclusiveIso),
    gte(createdInstant, day.startIso),
    lt(createdInstant, day.endExclusiveIso)
  );
}

async function businessDayWindow(db: DatabaseInstance, tenantId: string, now: Date) {
  const { businessDate, timezone } = await resolveTenantBusinessClock(db, tenantId, now);
  return resolveUtcDayWindow(businessDate, timezone);
}

/**
 * A repeat of an incident still open from today's business day refreshes that
 * row and returns its id; an earlier day's open incident gets a new row.
 */
export async function reportRegisterIncident(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string; userId: string },
  input: ReportRegisterIncidentInput,
  now: Date = new Date()
): Promise<{ id: string }> {
  const product = input.productId
    ? findTenantProduct(db, scope.tenantId, input.productId)
    : undefined;
  if (input.kind !== 'no_barcode' && !product) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This incident needs a product' });
  }
  const note = input.note?.trim() || null;
  const reason = input.kind === 'stockout' ? (input.reason ?? null) : null;
  const shelfPrice = input.kind === 'price_mismatch' ? (input.shelfPrice ?? null) : null;
  // An unlabeled item with neither product nor note has nothing to match on.
  const matchable = input.kind !== 'no_barcode' || product || note;
  if (matchable) {
    const day = await businessDayWindow(db, scope.tenantId, now);
    const existing = db
      .select({ id: registerIncidents.id })
      .from(registerIncidents)
      .where(
        and(
          eq(registerIncidents.tenantId, scope.tenantId),
          eq(registerIncidents.siteId, scope.siteId),
          eq(registerIncidents.kind, input.kind),
          eq(registerIncidents.status, 'open'),
          createdInBusinessDay(day),
          product
            ? eq(registerIncidents.productId, product.id)
            : isNull(registerIncidents.productId),
          input.kind === 'no_barcode'
            ? note
              ? sql`lower(${registerIncidents.note}) = lower(${note})`
              : isNull(registerIncidents.note)
            : undefined
        )
      )
      .get();
    if (existing) {
      db.update(registerIncidents)
        .set({
          ...(reason ? { reason } : {}),
          ...(shelfPrice !== null ? { shelfPrice } : {}),
          ...(note ? { note } : {}),
          systemPrice: product?.price ?? null,
          updatedAt: now.toISOString(),
        })
        .where(eq(registerIncidents.id, existing.id))
        .run();
      return existing;
    }
  }
  const session = getActiveCashSessionForCashier(db, scope.tenantId, scope.siteId, scope.userId);
  const id = nanoid();
  db.insert(registerIncidents)
    .values({
      id,
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      kind: input.kind,
      reason,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      shelfPrice,
      systemPrice: product?.price ?? null,
      note,
      reportedBy: scope.userId,
      cashSessionId: session?.id ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();
  return { id };
}

export function listOpenRegisterIncidents(
  db: DatabaseInstance,
  tenantId: string,
  siteId?: string
): RegisterIncidentRow[] {
  const rows = db
    .select({
      id: registerIncidents.id,
      siteId: registerIncidents.siteId,
      siteName: sites.name,
      kind: registerIncidents.kind,
      reason: registerIncidents.reason,
      productId: registerIncidents.productId,
      productName: registerIncidents.productName,
      shelfPrice: registerIncidents.shelfPrice,
      systemPrice: registerIncidents.systemPrice,
      note: registerIncidents.note,
      reportedBy: registerIncidents.reportedBy,
      reportedByName: users.name,
      createdAt: createdInstant,
    })
    .from(registerIncidents)
    .innerJoin(sites, eq(sites.id, registerIncidents.siteId))
    .innerJoin(users, eq(users.id, registerIncidents.reportedBy))
    .where(
      and(
        eq(registerIncidents.tenantId, tenantId),
        eq(registerIncidents.status, 'open'),
        siteId ? eq(registerIncidents.siteId, siteId) : undefined
      )
    )
    .orderBy(desc(createdInstant))
    .all();
  const stock = getStockBySite(
    db,
    tenantId,
    rows.flatMap(row => (row.productId ? [row.productId] : []))
  );
  return rows.map(row => ({
    ...row,
    stockBySite: row.productId ? (stock.get(row.productId) ?? []) : [],
  }));
}

export function resolveRegisterIncident(
  db: DatabaseInstance,
  scope: { tenantId: string; userId: string },
  input: { id: string; note?: string | undefined }
): { id: string } {
  const now = new Date().toISOString();
  const updated = db
    .update(registerIncidents)
    .set({
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: scope.userId,
      resolutionNote: input.note?.trim() || null,
      updatedAt: now,
    })
    .where(
      and(
        eq(registerIncidents.id, input.id),
        eq(registerIncidents.tenantId, scope.tenantId),
        eq(registerIncidents.status, 'open')
      )
    )
    .returning({ id: registerIncidents.id })
    .get();
  if (!updated) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Incident not found or already resolved' });
  }
  return updated;
}

export interface ProductSiteStock extends SiteStock {
  /** The tenant's other active sites with stock on hand, most stock first. */
  otherSites: SiteStock[];
}

/** On-hand of one product at the active site and at the tenant's other sites. */
export function getProductSiteStock(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string },
  productId: string
): ProductSiteStock {
  findTenantProduct(db, scope.tenantId, productId);
  const [stock] = withSiteStockBreakdown(db, scope.tenantId, scope.siteId, [{ id: productId }]);
  const site = db
    .select({ name: sites.name })
    .from(sites)
    .where(and(eq(sites.id, scope.siteId), eq(sites.tenantId, scope.tenantId)))
    .get();
  return {
    siteId: scope.siteId,
    siteName: site?.name ?? '',
    onHand: stock!.siteStock ?? 0,
    otherSites: stock!.otherSites ?? [],
  };
}

export interface LatestRegisterIncident {
  id: string;
  kind: RegisterIncidentKind;
  productName: string | null;
  note: string | null;
  createdAt: string;
  registerName: string | null;
}

/** Newest incident reported today, in the tenant's business day, at one site. */
export async function getLatestRegisterIncidentToday(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string },
  now: Date = new Date()
): Promise<LatestRegisterIncident | null> {
  const day = await businessDayWindow(db, scope.tenantId, now);
  const row = db
    .select({
      id: registerIncidents.id,
      kind: registerIncidents.kind,
      productName: registerIncidents.productName,
      note: registerIncidents.note,
      createdAt: createdInstant,
      registerName: cashSessions.registerName,
    })
    .from(registerIncidents)
    .leftJoin(cashSessions, eq(cashSessions.id, registerIncidents.cashSessionId))
    .where(
      and(
        eq(registerIncidents.tenantId, scope.tenantId),
        eq(registerIncidents.siteId, scope.siteId),
        createdInBusinessDay(day)
      )
    )
    // rowid breaks same-millisecond ties in insertion order.
    .orderBy(desc(createdInstant), desc(sql`${registerIncidents}.rowid`))
    .limit(1)
    .get();
  return row ?? null;
}
