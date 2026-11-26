import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, paymentOutbox, sites, users } from '../db/schema.js';
import {
  PRESENTATION_TTL_MS,
  closePresentationAdmin,
  expirePresentations,
  getPresentation,
  linkPresentationToSale,
  listOpenPresentations,
  startPresentation,
} from '../services/payments/presentation.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;

const destination = { id: 'dest-nequi', label: 'Nequi principal', kind: 'nequi' };

describe('static QR presentations', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = await db
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

  function show(key = nanoid(), amount = 60000) {
    return startPresentation(getDatabase(), {
      tenantId,
      siteId,
      userId,
      amount,
      destination,
      idempotencyKey: key,
    });
  }

  it('records a durable presentation with its facts and no provider rail', () => {
    const presentation = show();

    expect(presentation).toMatchObject({
      tenantId,
      siteId,
      amount: 60000,
      status: 'presented',
      destination,
      startedBy: userId,
    });

    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, presentation.id))
      .get();
    expect(row?.kind).toBe('presentation');
    // Explicitly not a provider integration, and nothing to dispatch.
    expect(row?.railId).toBe('static_qr');
    expect(row?.attempts).toBe(0);
    expect(row?.salePaymentId).toBeNull();
  });

  it('is idempotent: the same checkout key returns the same row', () => {
    const key = `checkout-${nanoid()}`;
    const first = show(key);
    const second = show(key);
    expect(second.id).toBe(first.id);

    const count = getDatabase()
      .select({ id: paymentOutbox.id })
      .from(paymentOutbox)
      .where(
        and(
          eq(paymentOutbox.tenantId, tenantId),
          eq(paymentOutbox.kind, 'presentation'),
          eq(paymentOutbox.idempotencyKey, `presentation:${tenantId}:${key}`)
        )
      )
      .all().length;
    expect(count).toBe(1);
  });

  it('works with no network at all: creation is local only', () => {
    // Nothing in this path performs I/O against a provider; the row and its
    // audit entry are written in one local transaction.
    const presentation = show(`offline-${nanoid()}`, 15000);
    const audit = getDatabase()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, presentation.id),
          eq(auditLogs.action, 'payment.presentation_started')
        )
      )
      .all();
    expect(audit).toHaveLength(1);
  });

  it('keeps presentations out of every charge processor', () => {
    const presentation = show();
    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, presentation.id))
      .get();
    // The three safety net layers: kind is never 'charge', the status is not a
    // queue state, and the rail refuses to act as a provider.
    expect(row?.kind).not.toBe('charge');
    expect(['queued', 'submitting', 'retrying']).not.toContain(row?.status);
    expect(row?.railId).toBe('static_qr');
  });

  it('links to the sale that finally happened, once', () => {
    const presentation = show(undefined, 45000);
    const saleId = nanoid();

    const linked = linkPresentationToSale(getDatabase(), {
      tenantId,
      presentationId: presentation.id,
      siteId,
      amount: 45000,
      saleId,
      salePaymentId: null,
      actorId: userId,
    });
    expect(linked.status).toBe('linked');

    // Single use: a second sale cannot claim the same presentation.
    expect(() =>
      linkPresentationToSale(getDatabase(), {
        tenantId,
        presentationId: presentation.id,
        siteId,
        amount: 45000,
        saleId: nanoid(),
        salePaymentId: null,
        actorId: userId,
      })
    ).toThrow(/already linked/i);
  });

  it('refuses to link across sites or with a mismatched amount', () => {
    const presentation = show(undefined, 30000);
    const otherSiteId = nanoid();

    expect(() =>
      linkPresentationToSale(getDatabase(), {
        tenantId,
        presentationId: presentation.id,
        siteId: otherSiteId,
        amount: 30000,
        saleId: nanoid(),
        salePaymentId: null,
        actorId: userId,
      })
    ).toThrow(/another site/i);

    expect(() =>
      linkPresentationToSale(getDatabase(), {
        tenantId,
        presentationId: presentation.id,
        siteId,
        amount: 29999,
        saleId: nanoid(),
        salePaymentId: null,
        actorId: userId,
      })
    ).toThrow(/does not match/i);
  });

  it('expires locally without deleting the record', () => {
    const presentation = show(undefined, 12000);
    const later = new Date(Date.now() + PRESENTATION_TTL_MS + 60_000);
    const expired = expirePresentations(getDatabase(), { now: later });
    expect(expired).toBeGreaterThanOrEqual(1);

    const row = getDatabase()
      .select()
      .from(paymentOutbox)
      .where(eq(paymentOutbox.id, presentation.id))
      .get();
    // The record survives so a late payment can still be reconciled.
    expect(row).toBeDefined();
    expect(row?.status).toBe('timeout');
  });

  it('closes administratively with a note, keeping the row consultable', () => {
    const presentation = show();
    const closed = closePresentationAdmin(getDatabase(), {
      tenantId,
      presentationId: presentation.id,
      actorId: userId,
      note: 'Cliente se fue sin pagar',
    });
    expect(closed.status).toBe('closed_admin');
    expect(getPresentation(getDatabase(), tenantId, presentation.id).status).toBe('closed_admin');

    const audit = getDatabase()
      .select({ after: auditLogs.after })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, presentation.id),
          eq(auditLogs.action, 'payment.presentation_closed_admin')
        )
      )
      .get();
    expect(audit?.after).toMatchObject({ note: 'Cliente se fue sin pagar' });
  });

  it('lists only open presentations of one site', () => {
    const mine = show(undefined, 21000);
    const open = listOpenPresentations(getDatabase(), tenantId, siteId);
    expect(open.some(presentation => presentation.id === mine.id)).toBe(true);
    expect(open.every(presentation => presentation.siteId === siteId)).toBe(true);
    expect(open.every(presentation => presentation.status === 'presented')).toBe(true);
  });

  it('isolates tenants', () => {
    const presentation = show();
    expect(() => getPresentation(getDatabase(), nanoid(), presentation.id)).toThrow(/not found/i);
  });
});
