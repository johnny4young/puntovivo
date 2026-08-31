import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import {
  cashSessions,
  products,
  sales,
  sequentials,
  sites,
  tenantLocaleSettings,
  tenants,
} from '../../../db/schema.js';
import { resolveReadinessProfile } from '../../../services/readiness/profile.js';
import {
  countActiveReceiptPrinters,
  countConfiguredPaymentRails,
  readFiscalConfigState,
  readSyncBacklog,
} from '../../../services/readiness/signals.js';
import type {
  CheckoutReadinessItem,
  CheckoutReadinessOutput,
  FirstSaleReadinessOutput,
} from '../../schemas/setupReadiness.js';
import { SYNC_BACKLOG_WARN_THRESHOLD } from './constants.js';

/**
 * Build cashier-facing checkout readiness for a tenant and site. Only
 * conditions that make the sale invalid, such as missing site numbering,
 * block checkout; fiscal, hardware, payment and sync degradations are warnings.
 */
export async function buildCheckoutReadiness(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
}): Promise<CheckoutReadinessOutput> {
  const { db, tenantId, siteId } = args;

  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const settings =
    tenantRow?.settings && typeof tenantRow.settings === 'object'
      ? (tenantRow.settings as Record<string, unknown>)
      : {};

  const localeRow = await db
    .select({ countryCode: tenantLocaleSettings.countryCode })
    .from(tenantLocaleSettings)
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();
  const profile = resolveReadinessProfile(localeRow?.countryCode);

  const items: CheckoutReadinessItem[] = [];
  const saleSequential = await db
    .select({ id: sequentials.id })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(
      and(
        eq(sequentials.tenantId, tenantId),
        eq(sequentials.siteId, siteId),
        eq(sequentials.documentType, 'sale'),
        eq(sites.tenantId, tenantId),
        eq(sites.isActive, true)
      )
    )
    .get();
  if (!saleSequential) {
    items.push({
      id: 'sale_sequential',
      severity: 'blocker',
      cta: { route: '/sequentials' },
    });
  }

  if (!profile.surfaceFiscalReminders) return { items };

  const fiscalState = readFiscalConfigState(settings);
  if (!fiscalState.enabled || !fiscalState.configured) {
    items.push({
      id: 'fiscal',
      severity: 'warning',
      cta: { route: '/company', tab: 'fiscal' },
    });
  }

  const printers = await countActiveReceiptPrinters(db, tenantId, siteId);
  if (printers === 0) {
    items.push({
      id: 'receipt_hardware',
      severity: 'warning',
      cta: { route: '/peripherals' },
    });
  }

  if (countConfiguredPaymentRails(settings) === 0) {
    items.push({
      id: 'payment_rail',
      severity: 'warning',
      cta: { route: '/company', tab: 'payments' },
    });
  }

  const backlog = await readSyncBacklog(db, tenantId);
  if (backlog.conflicts > 0 || backlog.pending > SYNC_BACKLOG_WARN_THRESHOLD) {
    items.push({
      id: 'sync',
      severity: 'warning',
      cta: { route: '/operations' },
    });
  }

  return { items };
}

/**
 * Build the living first-sale checklist for the current operator.
 * Tenant-wide history wins, while an open drawer is site and user scoped.
 */
export async function buildFirstSaleReadiness(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  userId: string;
}): Promise<FirstSaleReadinessOutput> {
  const { db, tenantId, siteId, userId } = args;

  const completedSaleRow = await db
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), eq(sales.status, 'completed')))
    .limit(1)
    .get();
  const hasFirstSale = Boolean(completedSaleRow?.id);

  if (hasFirstSale) {
    return {
      completed: true,
      steps: [
        { id: 'product', completed: true },
        { id: 'cashSession', completed: true },
        { id: 'firstSale', completed: true },
      ],
    };
  }

  const [productRow, cashSessionRow] = await Promise.all([
    db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.isActive, true)))
      .limit(1)
      .get(),
    db
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.tenantId, tenantId),
          eq(cashSessions.siteId, siteId),
          eq(cashSessions.cashierId, userId),
          eq(cashSessions.status, 'open')
        )
      )
      .limit(1)
      .get(),
  ]);

  return {
    completed: false,
    steps: [
      { id: 'product', completed: Boolean(productRow?.id) },
      { id: 'cashSession', completed: Boolean(cashSessionRow?.id) },
      { id: 'firstSale', completed: false },
    ],
  };
}
