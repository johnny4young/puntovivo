/**
 * Automatic confirmation for transfer and QR charges.
 *
 * When a wallet rail is live and configured, the register opens a provider
 * charge, keeps it as a `payment_outbox` row in `submitting`, and polls the
 * adapter until the provider approves or declines it. Without such a rail the
 * register keeps the manual confirmation. A local till has no public URL, so
 * confirmation is polled instead of received by webhook.
 *
 * @module services/payments/wallet-confirmation
 */

import { and, eq, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { paymentOutbox, type PaymentOutboxStatus, type PaymentRailId } from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { createModuleLogger } from '../../logging/logger.js';
import type { PaymentRailMethod, PaymentStatusResult } from './contracts.js';
import { readTenantPaymentSettings } from './credentials.js';
import { PAYMENT_RAIL_IDS, PAYMENT_RAILS_MANIFEST } from './manifest.js';
import { AMOUNT_EPSILON } from './reconciliation/constants.js';
import { getPaymentRailAdapter, isPaymentRailLive, validatePaymentRail } from './registry.js';

const log = createModuleLogger('services/payments/wallet-confirmation');

const WALLET_METHODS: ReadonlySet<PaymentRailMethod> = new Set(['wallet', 'qr', 'bank_transfer']);
const REGISTER_SOURCE = 'register';
const ABANDONED_AFTER_MS = 30 * 60_000;

export type WalletChargeStatus = 'pending' | 'approved' | 'declined';

export type StartWalletChargeResult =
  | { mode: 'manual'; providerUnavailable: boolean }
  | {
      mode: 'live';
      chargeId: string;
      railLabel: string;
      status: WalletChargeStatus;
      reference: string;
      qrPayload: string | null;
    };

export interface WalletChargeStatusResult {
  chargeId: string;
  status: WalletChargeStatus;
  reference: string;
}

function toWalletStatus(status: PaymentOutboxStatus | PaymentStatusResult['status']) {
  if (status === 'approved' || status === 'settled') return 'approved';
  if (status === 'submitting' || status === 'pending' || status === 'unknown') return 'pending';
  return 'declined';
}

/** First live rail that confirms transfers by polling and has every credential. */
export async function findLiveWalletRail(
  db: DatabaseInstance,
  tenantId: string,
  currencyCode: string
): Promise<PaymentRailId | null> {
  let settings: Record<string, unknown> | null = null;
  for (const railId of PAYMENT_RAIL_IDS) {
    if (!isPaymentRailLive(railId)) continue;
    const { capabilities } = getPaymentRailAdapter(railId);
    if (!capabilities.supportsStatusPolling) continue;
    if (!capabilities.currencies.includes(currencyCode)) continue;
    if (!capabilities.methods.some(method => WALLET_METHODS.has(method))) continue;
    settings ??= await readTenantPaymentSettings(db, tenantId);
    if ((await validatePaymentRail(railId, { tenantId, settings })).ok) return railId;
  }
  return null;
}

/** Whether the register should try a provider charge before falling back to manual. */
export async function hasLiveWalletRail(db: DatabaseInstance, tenantId: string) {
  if (!PAYMENT_RAIL_IDS.some(isPaymentRailLive)) return false;
  return (await findLiveWalletRail(db, tenantId, resolveTenantCurrency(db, tenantId))) !== null;
}

export async function startWalletCharge(
  db: DatabaseInstance,
  input: { tenantId: string; siteId: string; userId: string; amount: number }
): Promise<StartWalletChargeResult> {
  const currencyCode = resolveTenantCurrency(db, input.tenantId);
  const railId = await findLiveWalletRail(db, input.tenantId, currencyCode);
  if (!railId) return { mode: 'manual', providerUnavailable: false };

  const amount = roundMoney(input.amount);
  const reference = `pv-${nanoid(16)}`;
  let charge;
  try {
    charge = await getPaymentRailAdapter(railId).charge({
      tenantId: input.tenantId,
      amount,
      currencyCode,
      reference,
      metadata: { siteId: input.siteId },
    });
  } catch (err) {
    log.warn({ err, tenantId: input.tenantId, railId }, 'wallet charge could not start');
    return { mode: 'manual', providerUnavailable: true };
  }

  const status = charge.status === 'pending' ? 'submitting' : charge.status;
  const chargeId = nanoid();
  const nowIso = new Date().toISOString();
  await db
    .insert(paymentOutbox)
    .values({
      id: chargeId,
      tenantId: input.tenantId,
      railId,
      kind: 'charge',
      status,
      amount,
      currencyCode,
      reference,
      providerTransactionId: charge.providerTransactionId,
      payload: { source: REGISTER_SOURCE, siteId: input.siteId, startedBy: input.userId },
      attempts: 1,
      lastError:
        charge.status === 'declined'
          ? { kind: 'PROVIDER_DECLINED', message: charge.reason }
          : charge.status === 'timeout'
            ? { kind: 'PROVIDER_TIMEOUT', message: 'Provider did not answer the charge' }
            : null,
      idempotencyKey: reference,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  if (charge.status === 'timeout') return { mode: 'manual', providerUnavailable: true };
  return {
    mode: 'live',
    chargeId,
    railLabel: PAYMENT_RAILS_MANIFEST[railId].label,
    status: toWalletStatus(status),
    reference: charge.providerTransactionId,
    qrPayload: charge.status === 'pending' ? (charge.qrPayload ?? null) : null,
  };
}

const isRegisterCharge = (): SQL =>
  sql`json_extract(${paymentOutbox.payload}, '$.source') = ${REGISTER_SOURCE}`;

async function loadRegisterCharge(db: DatabaseInstance, tenantId: string, chargeId: string) {
  const row = await db
    .select({
      id: paymentOutbox.id,
      railId: paymentOutbox.railId,
      status: paymentOutbox.status,
      providerTransactionId: paymentOutbox.providerTransactionId,
    })
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.id, chargeId),
        eq(paymentOutbox.tenantId, tenantId),
        eq(paymentOutbox.kind, 'charge'),
        isRegisterCharge()
      )
    )
    .get();
  if (!row) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'PAYMENT_OUTBOX_NOT_FOUND',
      message: `Wallet charge ${chargeId} not found for this tenant`,
      details: { chargeId },
    });
  }
  return row;
}

/** Moves a still-pending charge to its verdict; false when another writer got there first. */
async function settlePending(
  db: DatabaseInstance,
  row: { id: string; tenantId: string },
  status: 'approved' | 'declined' | 'timeout',
  lastError: Record<string, unknown> | null
): Promise<boolean> {
  const updated = await db
    .update(paymentOutbox)
    .set({ status, lastError, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(paymentOutbox.id, row.id),
        eq(paymentOutbox.tenantId, row.tenantId),
        eq(paymentOutbox.status, 'submitting')
      )
    )
    .returning({ id: paymentOutbox.id })
    .get();
  return updated !== undefined;
}

async function pollProvider(
  tenantId: string,
  row: { railId: PaymentRailId; providerTransactionId: string }
): Promise<WalletChargeStatus> {
  try {
    const result = await getPaymentRailAdapter(row.railId).getStatus({
      tenantId,
      providerTransactionId: row.providerTransactionId,
    });
    return toWalletStatus(result.status);
  } catch (err) {
    log.warn({ err, tenantId, railId: row.railId }, 'wallet status poll failed');
    return 'pending';
  }
}

const DECLINED = { kind: 'PROVIDER_DECLINED', message: 'Provider declined the charge' };

/** Ask the provider once and settle the row when it has a verdict. */
export async function getWalletChargeStatus(
  db: DatabaseInstance,
  input: { tenantId: string; chargeId: string }
): Promise<WalletChargeStatusResult> {
  const row = await loadRegisterCharge(db, input.tenantId, input.chargeId);
  const reference = row.providerTransactionId ?? '';
  const result = (status: WalletChargeStatus) => ({ chargeId: row.id, status, reference });
  if (row.status !== 'submitting' || !row.providerTransactionId) {
    return result(toWalletStatus(row.status));
  }

  const verdict = await pollProvider(input.tenantId, {
    railId: row.railId,
    providerTransactionId: row.providerTransactionId,
  });
  const scoped = { id: row.id, tenantId: input.tenantId };
  if (verdict === 'pending') {
    // A charge someone still polls is not abandoned.
    await db
      .update(paymentOutbox)
      .set({ updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(paymentOutbox.id, row.id),
          eq(paymentOutbox.tenantId, input.tenantId),
          eq(paymentOutbox.status, 'submitting')
        )
      )
      .run();
    return result(verdict);
  }
  if (await settlePending(db, scoped, verdict, verdict === 'declined' ? DECLINED : null)) {
    return result(verdict);
  }
  const current = await loadRegisterCharge(db, input.tenantId, input.chargeId);
  return result(toWalletStatus(current.status));
}

/**
 * The cashier left the charge (new total, other method, closed sheet). The
 * provider is asked first so a payment that already went through stays approved.
 */
export async function cancelWalletCharge(
  db: DatabaseInstance,
  input: { tenantId: string; chargeId: string }
): Promise<{ chargeId: string; status: WalletChargeStatus }> {
  const scoped = { id: input.chargeId, tenantId: input.tenantId };
  const row = await loadRegisterCharge(db, input.tenantId, input.chargeId);
  if (row.status === 'submitting') {
    const verdict = row.providerTransactionId
      ? await pollProvider(input.tenantId, {
          railId: row.railId,
          providerTransactionId: row.providerTransactionId,
        })
      : 'pending';
    const settled =
      verdict === 'approved'
        ? await settlePending(db, scoped, 'approved', null)
        : await settlePending(db, scoped, 'declined', {
            kind: verdict === 'declined' ? 'PROVIDER_DECLINED' : 'CANCELLED',
            message:
              verdict === 'declined'
                ? 'Provider declined the charge'
                : 'The register left this charge',
          });
    if (settled)
      return { chargeId: row.id, status: verdict === 'approved' ? 'approved' : 'declined' };
  }
  const current = await loadRegisterCharge(db, input.tenantId, input.chargeId);
  return { chargeId: row.id, status: toWalletStatus(current.status) };
}

/**
 * Register charges nobody polls any more (closed browser, lost network): ask
 * the provider one last time, then mark the rest timed out for reconciliation.
 */
export async function expireAbandonedWalletCharges(
  db: DatabaseInstance,
  now = Date.now()
): Promise<number> {
  const cutoff = new Date(now - ABANDONED_AFTER_MS).toISOString();
  const rows = await db
    .select({
      id: paymentOutbox.id,
      tenantId: paymentOutbox.tenantId,
      railId: paymentOutbox.railId,
      providerTransactionId: paymentOutbox.providerTransactionId,
    })
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.status, 'submitting'),
        eq(paymentOutbox.kind, 'charge'),
        isNull(paymentOutbox.lockedAt),
        lte(paymentOutbox.updatedAt, cutoff),
        isRegisterCharge()
      )
    )
    .all();
  let expired = 0;
  for (const row of rows) {
    const verdict = row.providerTransactionId
      ? await pollProvider(row.tenantId, {
          railId: row.railId,
          providerTransactionId: row.providerTransactionId,
        })
      : 'pending';
    if (verdict === 'pending') {
      const abandoned = { kind: 'ABANDONED', message: 'No register confirmed this charge' };
      if (await settlePending(db, row, 'timeout', abandoned)) expired += 1;
    } else {
      await settlePending(db, row, verdict, verdict === 'declined' ? DECLINED : null);
    }
  }
  return expired;
}

/**
 * Link an approved register charge to the transfer tender that carries its
 * provider reference, so reconciliation sees it matched instead of orphaned.
 */
export function linkWalletChargeToTender(
  tx: Pick<DatabaseInstance, 'update'>,
  args: {
    tenantId: string;
    salePaymentId: string;
    method: string;
    reference: string | null;
    amount: number;
  }
): void {
  if (args.method !== 'transfer' || !args.reference) return;
  tx.update(paymentOutbox)
    .set({ salePaymentId: args.salePaymentId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(paymentOutbox.tenantId, args.tenantId),
        eq(paymentOutbox.providerTransactionId, args.reference),
        eq(paymentOutbox.kind, 'charge'),
        isRegisterCharge(),
        sql`${paymentOutbox.status} IN ('approved', 'settled')`,
        isNull(paymentOutbox.salePaymentId),
        sql`abs(${paymentOutbox.amount} - ${args.amount}) <= ${AMOUNT_EPSILON}`
      )
    )
    .run();
}
