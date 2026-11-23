import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { paymentOutbox, salePayments, sales, sites, users } from '../db/schema.js';
import {
  linkPresentationToTender,
  startPresentation,
} from '../services/payments/presentation.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;
const destination = { id: 'dest-nequi', label: 'Nequi', kind: 'nequi' };

function show(amount: number, key = nanoid()) {
  return startPresentation(getDatabase(), {
    tenantId,
    siteId,
    userId,
    amount,
    destination,
    idempotencyKey: key,
  });
}

/** A sale row plus an inserted tender, as the sale transaction leaves them. */
function saleWithTender(amount: number): { saleId: string; salePaymentId: string } {
  const now = new Date().toISOString();
  const saleId = nanoid();
  const salePaymentId = nanoid();
  getDatabase()
    .insert(sales)
    .values({
      id: saleId,
      tenantId,
      saleNumber: `S-${nanoid(6)}`,
      status: 'draft',
      paymentStatus: 'pending',
      subtotal: amount,
      total: amount,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  getDatabase()
    .insert(salePayments)
    .values({
      id: salePaymentId,
      tenantId,
      saleId,
      method: 'transfer',
      amount,
      reference: null,
      confirmationStatus: 'pending',
      createdAt: now,
    })
    .run();
  return { saleId, salePaymentId };
}

describe('linking a presentation to its tender inside the sale transaction', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected active site');
    siteId = site.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('links a presented QR to the tender that charged it', () => {
    const presentation = show(45000);
    const { saleId, salePaymentId } = saleWithTender(45000);

    getDatabase().transaction(tx => {
      linkPresentationToTender(tx, {
        tenantId,
        saleId,
        salePaymentId,
        presentationId: presentation.id,
        amount: 45000,
      });
    });

    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, presentation.id))
      .get();
    expect(row?.status).toBe('linked');
    expect(row?.salePaymentId).toBe(salePaymentId);
    expect((row?.payload as { saleId?: string }).saleId).toBe(saleId);
  });

  it('still links an expired presentation: a late payment is reconcilable', () => {
    const presentation = show(30000);
    getDatabase()
      .update(paymentOutbox)
      .set({ status: 'timeout' })
      .where(eq(paymentOutbox.id, presentation.id))
      .run();
    const { saleId, salePaymentId } = saleWithTender(30000);

    getDatabase().transaction(tx => {
      linkPresentationToTender(tx, {
        tenantId,
        saleId,
        salePaymentId,
        presentationId: presentation.id,
        amount: 30000,
      });
    });
    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, presentation.id))
      .get();
    expect(row?.status).toBe('linked');
  });

  it('aborts the sale when the presentation was already linked', () => {
    const presentation = show(20000);
    const first = saleWithTender(20000);
    getDatabase().transaction(tx => {
      linkPresentationToTender(tx, {
        tenantId,
        saleId: first.saleId,
        salePaymentId: first.salePaymentId,
        presentationId: presentation.id,
        amount: 20000,
      });
    });

    const second = saleWithTender(20000);
    // The second link throws inside the transaction, so the sale it belongs to
    // must roll back with it: never a charged sale beside an open QR.
    expect(() =>
      getDatabase().transaction(tx => {
        linkPresentationToTender(tx, {
          tenantId,
          saleId: second.saleId,
          salePaymentId: second.salePaymentId,
          presentationId: presentation.id,
          amount: 20000,
        });
        tx.delete(sales).where(eq(sales.id, second.saleId)).run();
      })
    ).toThrow(/already linked or closed/i);

    const stillThere = getDatabase().select().from(sales).where(eq(sales.id, second.saleId)).get();
    expect(stillThere).toBeDefined();
  });

  it('refuses an amount that does not match what the customer was shown', () => {
    const presentation = show(50000);
    const { saleId, salePaymentId } = saleWithTender(49000);
    expect(() =>
      getDatabase().transaction(tx => {
        linkPresentationToTender(tx, {
          tenantId,
          saleId,
          salePaymentId,
          presentationId: presentation.id,
          amount: 49000,
        });
      })
    ).toThrow(/does not match/i);
  });

  it('keeps two simultaneous checkouts independent', () => {
    const a = show(60000);
    const b = show(60000);
    expect(a.id).not.toBe(b.id);

    const first = saleWithTender(60000);
    const second = saleWithTender(60000);
    getDatabase().transaction(tx => {
      linkPresentationToTender(tx, {
        tenantId,
        saleId: first.saleId,
        salePaymentId: first.salePaymentId,
        presentationId: a.id,
        amount: 60000,
      });
    });
    getDatabase().transaction(tx => {
      linkPresentationToTender(tx, {
        tenantId,
        saleId: second.saleId,
        salePaymentId: second.salePaymentId,
        presentationId: b.id,
        amount: 60000,
      });
    });

    const rows = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(and(eq(paymentOutbox.tenantId, tenantId), eq(paymentOutbox.kind, 'presentation')))
      .all();
    const linked = rows.filter(row => row.status === 'linked');
    expect(linked.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves cash and card tenders untouched by any of this', () => {
    const now = new Date().toISOString();
    const saleId = nanoid();
    getDatabase()
      .insert(sales)
      .values({
        id: saleId,
        tenantId,
        saleNumber: `S-${nanoid(6)}`,
        status: 'draft',
        paymentStatus: 'pending',
        subtotal: 10000,
        total: 10000,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const cashId = nanoid();
    getDatabase()
      .insert(salePayments)
      .values({
        id: cashId,
        tenantId,
        saleId,
        method: 'cash',
        amount: 10000,
        reference: null,
        createdAt: now,
      })
      .run();

    const tender = getDatabase()
      .select()
      .from(salePayments)
      .where(eq(salePayments.id, cashId))
      .get();
    expect(tender?.confirmationStatus).toBeNull();
    expect(tender?.confirmationSource).toBeNull();
  });
});
