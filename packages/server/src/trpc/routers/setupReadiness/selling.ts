import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import {
  cashSessions,
  products,
  sales,
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
 * Build cashier-facing checkout reminders for a tenant and site.
 * Every item is a warning: selling is never blocked by readiness state.
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

  if (!profile.surfaceFiscalReminders) return { items: [] };

  const items: CheckoutReadinessItem[] = [];
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
