/**
 * Till incidents: a cashier flags a stockout, a shelf price that differs from
 * the system price, or a product without a barcode, and keeps selling. The
 * open rows feed the manager's pending queue until someone resolves them.
 *
 * @module services/register-incidents
 */
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../db/index.js';
import {
  inventoryBalances,
  products,
  registerIncidents,
  sites,
  users,
  type RegisterIncidentKind,
  type RegisterIncidentReason,
} from '../db/schema.js';
import { getActiveCashSessionForCashier } from './cash-session/queries.js';

export interface ReportRegisterIncidentInput {
  kind: RegisterIncidentKind;
  productId?: string | undefined;
  reason?: RegisterIncidentReason | undefined;
  shelfPrice?: number | undefined;
  note?: string | undefined;
}

export interface SiteStock {
  siteId: string;
  siteName: string;
  onHand: number;
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

/** On-hand of each product at every site of the tenant, sites without a balance omitted. */
export function getStockBySite(
  db: DatabaseInstance,
  tenantId: string,
  productIds: readonly string[]
): Map<string, SiteStock[]> {
  const result = new Map<string, SiteStock[]>();
  if (productIds.length === 0) return result;
  const rows = db
    .select({
      productId: inventoryBalances.productId,
      siteId: inventoryBalances.siteId,
      siteName: sites.name,
      onHand: inventoryBalances.onHand,
    })
    .from(inventoryBalances)
    .innerJoin(sites, and(eq(sites.id, inventoryBalances.siteId), eq(sites.tenantId, tenantId)))
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        inArray(inventoryBalances.productId, [...productIds])
      )
    )
    .orderBy(asc(sites.name))
    .all();
  for (const row of rows) {
    const list = result.get(row.productId) ?? [];
    list.push({ siteId: row.siteId, siteName: row.siteName, onHand: row.onHand });
    result.set(row.productId, list);
  }
  return result;
}

export function reportRegisterIncident(
  db: DatabaseInstance,
  scope: { tenantId: string; siteId: string; userId: string },
  input: ReportRegisterIncidentInput
): { id: string } {
  const product = input.productId
    ? db
        .select({ id: products.id, name: products.name, price: products.price })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.tenantId, scope.tenantId)))
        .get()
    : undefined;
  if (input.productId && !product) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
  }
  if (input.kind !== 'no_barcode' && !product) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This incident needs a product' });
  }
  const session = getActiveCashSessionForCashier(db, scope.tenantId, scope.siteId, scope.userId);
  const id = nanoid();
  db.insert(registerIncidents)
    .values({
      id,
      tenantId: scope.tenantId,
      siteId: scope.siteId,
      kind: input.kind,
      reason: input.kind === 'stockout' ? (input.reason ?? null) : null,
      productId: product?.id ?? null,
      productName: product?.name ?? null,
      shelfPrice: input.kind === 'price_mismatch' ? (input.shelfPrice ?? null) : null,
      systemPrice: product?.price ?? null,
      note: input.note?.trim() || null,
      reportedBy: scope.userId,
      cashSessionId: session?.id ?? null,
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
      createdAt: registerIncidents.createdAt,
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
    .orderBy(desc(registerIncidents.createdAt))
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
