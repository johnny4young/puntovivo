import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '../db/index.js';
import { paymentOutbox, sites, users } from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import type {
  PaymentChargeInput,
  PaymentChargeResult,
  PaymentRailAdapter,
  PaymentStatusResult,
} from '../services/payments/contracts.js';
import { DeterministicPaymentRailAdapter } from '../services/payments/mock-adapter.js';
import { PAYMENT_RAILS_MANIFEST } from '../services/payments/manifest.js';
import { __overridePaymentRailForTests } from '../services/payments/registry.js';
import { expireAbandonedWalletCharges } from '../services/payments/wallet-confirmation.js';
import { computeNeedsAttention } from '../services/operations/attention.js';
import { getPaymentReconciliation } from '../services/payments/reconciliation.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let restore: (() => void) | null = null;

class FakeWalletAdapter implements PaymentRailAdapter {
  readonly railId = 'nequi' as const;
  readonly capabilities = PAYMENT_RAILS_MANIFEST.nequi.capabilities;
  readonly liveIntegration = true;
  readonly credentials = new DeterministicPaymentRailAdapter('nequi');
  verdict: PaymentStatusResult['status'] = 'pending';
  chargeResult: 'pending' | 'declined' | 'timeout' | 'throw' = 'pending';
  statusThrows = false;
  statusCalls = 0;
  charges: PaymentChargeInput[] = [];

  async charge(input: PaymentChargeInput): Promise<PaymentChargeResult> {
    this.charges.push(input);
    const providerTransactionId = `nequi_${this.charges.length}_${input.reference.slice(3, 9)}`;
    if (this.chargeResult === 'throw') throw new Error('provider down');
    if (this.chargeResult === 'declined') {
      return { status: 'declined', providerTransactionId, reason: 'insufficient funds' };
    }
    if (this.chargeResult === 'timeout') {
      return { status: 'timeout', providerTransactionId, retryable: true };
    }
    return {
      status: 'pending',
      providerTransactionId,
      reference: input.reference,
      qrPayload: `NEQUI-QR:${providerTransactionId}`,
    };
  }

  async refund(): Promise<never> {
    throw new Error('not used');
  }

  async getStatus(input: { providerTransactionId: string }): Promise<PaymentStatusResult> {
    this.statusCalls += 1;
    if (this.statusThrows) throw new Error('poll failed');
    return { status: this.verdict, providerTransactionId: input.providerTransactionId };
  }

  validateConfig = this.credentials.validateConfig.bind(this.credentials);
}

let fake: FakeWalletAdapter;

function ctxFor(
  role: 'admin' | 'manager' | 'cashier' | 'viewer',
  overrides: Partial<Context> = {}
): Context {
  const user = { id: userId, email: 'admin@localhost', role, tenantId };
  return {
    req: { server: server.app, headers: {}, user: { userId, ...user } } as never,
    res: {} as Context['res'],
    db: getDatabase(),
    user,
    tenantId,
    siteId,
    ...overrides,
  } as Context;
}

const admin = () => appRouter.createCaller(ctxFor('admin'));
const cashier = () => appRouter.createCaller(ctxFor('cashier'));

async function configureNequi() {
  await admin().paymentSettings.updateRail({
    railId: 'nequi',
    credentials: { apiKey: 'test-key', merchantId: 'm-1' },
  });
}

describe('wallet charge confirmation', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const row = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!row) throw new Error('Expected seeded admin user');
    tenantId = row.tenantId;
    userId = row.id;
    const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!site) throw new Error('Expected a seeded site');
    siteId = site.id;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    getDatabase().delete(paymentOutbox).run();
    fake = new FakeWalletAdapter();
    await admin().paymentSettings.updateRail({
      railId: 'nequi',
      credentials: { apiKey: null, merchantId: null },
    });
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('keeps manual confirmation while no rail ships a live provider', async () => {
    await configureNequi();
    const result = await cashier().payments.startWalletCharge({ siteId, amount: 87_420 });

    expect(result).toEqual({ mode: 'manual', providerUnavailable: false });
    expect(getDatabase().select().from(paymentOutbox).all()).toHaveLength(0);
  });

  it('never treats a live rail as ready without its credentials', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    const result = await cashier().payments.startWalletCharge({ siteId, amount: 87_420 });

    expect(result).toEqual({ mode: 'manual', providerUnavailable: false });
    expect(fake.charges).toHaveLength(0);
  });

  it('opens a pending charge and confirms it once the provider approves', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();

    const started = await cashier().payments.startWalletCharge({ siteId, amount: 87_420 });
    if (started.mode !== 'live') throw new Error('expected a live charge');
    expect(started).toMatchObject({
      railLabel: 'Nequi',
      status: 'pending',
      qrPayload: `NEQUI-QR:${started.reference}`,
    });
    expect(fake.charges[0]).toMatchObject({ amount: 87_420, metadata: { siteId } });

    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, started.chargeId))
      .get();
    expect(row).toMatchObject({
      tenantId,
      railId: 'nequi',
      kind: 'charge',
      status: 'submitting',
      amount: 87_420,
      providerTransactionId: started.reference,
      lockedAt: null,
      payload: { source: 'register', siteId, startedBy: userId },
    });

    const waiting = await cashier().payments.walletChargeStatus({ chargeId: started.chargeId });
    expect(waiting).toEqual({
      chargeId: started.chargeId,
      status: 'pending',
      reference: started.reference,
    });

    fake.verdict = 'approved';
    const approved = await cashier().payments.walletChargeStatus({ chargeId: started.chargeId });
    expect(approved.status).toBe('approved');
    const callsAfterApproval = fake.statusCalls;
    await cashier().payments.walletChargeStatus({ chargeId: started.chargeId });
    expect(fake.statusCalls).toBe(callsAfterApproval);
    expect(
      getDatabase().select().from(paymentOutbox).where(eq(paymentOutbox.id, started.chargeId)).get()
        ?.status
    ).toBe('approved');
  });

  it('records a provider decline and keeps a failed poll pending', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    const started = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (started.mode !== 'live') throw new Error('expected a live charge');

    fake.statusThrows = true;
    expect(
      (await cashier().payments.walletChargeStatus({ chargeId: started.chargeId })).status
    ).toBe('pending');

    fake.statusThrows = false;
    fake.verdict = 'declined';
    expect(
      (await cashier().payments.walletChargeStatus({ chargeId: started.chargeId })).status
    ).toBe('declined');
    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, started.chargeId))
      .get();
    expect(row?.status).toBe('declined');
    expect(row?.lastError).toMatchObject({ kind: 'PROVIDER_DECLINED' });
  });

  it('falls back to manual when the provider cannot open the charge', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();

    fake.chargeResult = 'throw';
    expect(await cashier().payments.startWalletCharge({ siteId, amount: 5_000 })).toEqual({
      mode: 'manual',
      providerUnavailable: true,
    });

    fake.chargeResult = 'timeout';
    expect(await cashier().payments.startWalletCharge({ siteId, amount: 5_000 })).toEqual({
      mode: 'manual',
      providerUnavailable: true,
    });
    expect(getDatabase().select().from(paymentOutbox).get()?.status).toBe('timeout');

    fake.chargeResult = 'declined';
    const declined = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    expect(declined).toMatchObject({ mode: 'live', status: 'declined', qrPayload: null });
  });

  it('cancels a pending charge but never an approved one', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();

    const left = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (left.mode !== 'live') throw new Error('expected a live charge');
    expect(await cashier().payments.cancelWalletCharge({ chargeId: left.chargeId })).toEqual({
      chargeId: left.chargeId,
      status: 'declined',
    });
    expect(
      getDatabase().select().from(paymentOutbox).where(eq(paymentOutbox.id, left.chargeId)).get()
        ?.lastError
    ).toMatchObject({ kind: 'CANCELLED' });

    const paid = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (paid.mode !== 'live') throw new Error('expected a live charge');
    fake.verdict = 'approved';
    await cashier().payments.walletChargeStatus({ chargeId: paid.chargeId });
    expect(await cashier().payments.cancelWalletCharge({ chargeId: paid.chargeId })).toEqual({
      chargeId: paid.chargeId,
      status: 'approved',
    });

    const paidJustNow = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (paidJustNow.mode !== 'live') throw new Error('expected a live charge');
    expect(await cashier().payments.cancelWalletCharge({ chargeId: paidJustNow.chargeId })).toEqual(
      { chargeId: paidJustNow.chargeId, status: 'approved' }
    );
  });

  it('scopes charges to the tenant, its sites and the sales roles', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    const started = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (started.mode !== 'live') throw new Error('expected a live charge');

    const outsider = appRouter.createCaller(
      ctxFor('cashier', {
        tenantId: 'other-tenant',
        user: { id: userId, email: 'x@y', role: 'cashier', tenantId: 'other-tenant' },
      })
    );
    await expect(
      outsider.payments.walletChargeStatus({ chargeId: started.chargeId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      outsider.payments.cancelWalletCharge({ chargeId: started.chargeId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      cashier().payments.startWalletCharge({ siteId: 'site-of-someone-else', amount: 5_000 })
    ).rejects.toBeTruthy();
    await expect(
      appRouter.createCaller(ctxFor('viewer')).payments.startWalletCharge({ siteId, amount: 5_000 })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const statementRow = getDatabase()
      .insert(paymentOutbox)
      .values({
        id: 'statement-row',
        tenantId,
        railId: 'nequi',
        kind: 'charge',
        status: 'submitting',
        amount: 5_000,
        reference: 'statement',
        providerTransactionId: 'nequi_statement',
      })
      .returning()
      .get();
    await expect(
      cashier().payments.walletChargeStatus({ chargeId: statementRow.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('tells the register whether to try a provider before it opens the sheet', async () => {
    const forCharge = () => cashier().transferDestinations.forCharge({ siteId, locale: 'es' });
    expect((await forCharge()).autoConfirm).toBe(false);
    restore = __overridePaymentRailForTests('nequi', fake);
    expect((await forCharge()).autoConfirm).toBe(false);
    await configureNequi();
    expect((await forCharge()).autoConfirm).toBe(true);
  });

  it('rounds the charge to cents before the provider sees it', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    await cashier().payments.startWalletCharge({ siteId, amount: 33.333 });
    expect(fake.charges[0]?.amount).toBe(33.33);
  });

  it('times out register charges nobody polls, after one last provider check', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    const forgotten = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    const paidLate = await cashier().payments.startWalletCharge({ siteId, amount: 6_000 });
    const fresh = await cashier().payments.startWalletCharge({ siteId, amount: 7_000 });
    if (forgotten.mode !== 'live' || paidLate.mode !== 'live' || fresh.mode !== 'live') {
      throw new Error('expected live charges');
    }
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    for (const id of [forgotten.chargeId, paidLate.chargeId, fresh.chargeId]) {
      getDatabase()
        .update(paymentOutbox)
        .set({ updatedAt: old })
        .where(eq(paymentOutbox.id, id))
        .run();
    }
    fake.getStatus = async input => ({
      status: input.providerTransactionId === paidLate.reference ? 'approved' : 'pending',
      providerTransactionId: input.providerTransactionId,
    });

    // The register still polls this one, so it is not abandoned.
    await cashier().payments.walletChargeStatus({ chargeId: fresh.chargeId });

    expect(await expireAbandonedWalletCharges(getDatabase())).toBe(1);
    const statusOf = (id: string) =>
      getDatabase().select().from(paymentOutbox).where(eq(paymentOutbox.id, id)).get();
    expect(statusOf(forgotten.chargeId)).toMatchObject({
      status: 'timeout',
      lastError: { kind: 'ABANDONED' },
    });
    expect(statusOf(paidLate.chargeId)?.status).toBe('approved');
    expect(statusOf(fresh.chargeId)?.status).toBe('submitting');
  });

  it('tracks the charge before the provider opens it and never retries a register charge', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    let rowsWhenProviderCalled = -1;
    const charge = fake.charge.bind(fake);
    fake.charge = async input => {
      rowsWhenProviderCalled = getDatabase().select().from(paymentOutbox).all().length;
      return charge(input);
    };
    const started = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (started.mode !== 'live') throw new Error('expected a live charge');
    expect(rowsWhenProviderCalled).toBe(1);

    await cashier().payments.cancelWalletCharge({ chargeId: started.chargeId });
    await expect(
      admin().payments.retryOutbox({ outboxId: started.chargeId })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const attention = await computeNeedsAttention(getDatabase(), tenantId);
    expect(attention.areas.find(area => area.area === 'payments')).toBeUndefined();
    const report = await getPaymentReconciliation(getDatabase(), tenantId, { limit: 50 });
    expect(report.mismatches.filter(row => row.paymentOutboxId === started.chargeId)).toEqual([]);
  });

  it('refreshes a polled charge about once a minute, not on every poll', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    const started = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    if (started.mode !== 'live') throw new Error('expected a live charge');
    const setUpdatedAt = (msAgo: number) => {
      const value = new Date(Date.now() - msAgo).toISOString();
      getDatabase()
        .update(paymentOutbox)
        .set({ updatedAt: value })
        .where(eq(paymentOutbox.id, started.chargeId))
        .run();
      return value;
    };
    const updatedAt = () =>
      getDatabase().select().from(paymentOutbox).where(eq(paymentOutbox.id, started.chargeId)).get()
        ?.updatedAt;

    const recent = setUpdatedAt(20_000);
    await cashier().payments.walletChargeStatus({ chargeId: started.chargeId });
    expect(updatedAt()).toBe(recent);

    const old = setUpdatedAt(2 * 60_000);
    await cashier().payments.walletChargeStatus({ chargeId: started.chargeId });
    expect(updatedAt()).not.toBe(old);
  });

  it('checks a cancelled charge once more so a late payment is not lost', async () => {
    restore = __overridePaymentRailForTests('nequi', fake);
    await configureNequi();
    const paidLate = await cashier().payments.startWalletCharge({ siteId, amount: 5_000 });
    const neverPaid = await cashier().payments.startWalletCharge({ siteId, amount: 6_000 });
    if (paidLate.mode !== 'live' || neverPaid.mode !== 'live') throw new Error('expected live');
    await cashier().payments.cancelWalletCharge({ chargeId: paidLate.chargeId });
    await cashier().payments.cancelWalletCharge({ chargeId: neverPaid.chargeId });
    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    getDatabase().update(paymentOutbox).set({ updatedAt: old }).run();
    let polls = 0;
    fake.getStatus = async input => {
      polls += 1;
      return {
        status: input.providerTransactionId === paidLate.reference ? 'approved' : 'pending',
        providerTransactionId: input.providerTransactionId,
      };
    };

    await expireAbandonedWalletCharges(getDatabase());
    expect(polls).toBe(2);
    const row = (id: string) =>
      getDatabase().select().from(paymentOutbox).where(eq(paymentOutbox.id, id)).get();
    expect(row(paidLate.chargeId)).toMatchObject({ status: 'approved', lastError: null });
    expect(row(neverPaid.chargeId)).toMatchObject({
      status: 'declined',
      lastError: { kind: 'CANCELLED', rechecked: true },
    });
    await expireAbandonedWalletCharges(getDatabase());
    expect(polls).toBe(2);
  });
});
