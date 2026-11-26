/**
 * Static QR presentations (design V3.3 §4).
 *
 * A static store QR is shown to the customer before any sale exists. The bank
 * never tells Puntovivo anything about it, so the durable record of "this QR,
 * for this amount, at this site, was shown at this time" has to live locally.
 *
 * `payment_outbox` already models exactly that shape for live rails — a
 * pre-sale row with tenant, site, amount, actor and a lifecycle — so the
 * presentation rides there under `kind = 'presentation'`. Two rules follow and
 * are enforced below rather than documented:
 *
 *   1. A presentation is never dispatched, polled or settled against a
 *      provider. Every charge processor filters `kind = 'charge'`.
 *   2. A presentation never counts as money. It becomes revenue only when it
 *      is linked to the sale that actually happened, and even then the money
 *      is confirmed separately.
 *
 * @module services/payments/presentation
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import { paymentOutbox } from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { roundMoney } from '../../lib/money.js';
import { writeAuditLog } from '../audit-logs.js';

/** Presentations older than this without a sale are expired locally. */
export const PRESENTATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PresentationDestination {
  id: string;
  label: string;
  kind: string;
}

export interface StartPresentationInput {
  tenantId: string;
  siteId: string;
  userId: string;
  amount: number;
  destination: PresentationDestination;
  /** Stable per checkout attempt: a re-render or an offline retry reuses it. */
  idempotencyKey: string;
  operationId?: string | undefined;
}

export interface Presentation {
  id: string;
  tenantId: string;
  siteId: string;
  amount: number;
  currencyCode: string;
  destination: PresentationDestination;
  status: string;
  startedBy: string | null;
  createdAt: string;
}

function toPresentation(row: {
  id: string;
  tenantId: string;
  amount: number;
  currencyCode: string;
  status: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}): Presentation {
  const payload = row.payload ?? {};
  return {
    id: row.id,
    tenantId: row.tenantId,
    siteId: String(payload.siteId ?? ''),
    amount: row.amount,
    currencyCode: row.currencyCode,
    destination: payload.destination as PresentationDestination,
    status: row.status,
    startedBy: (payload.startedBy as string | undefined) ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Record a presentation, or return the one this key already created.
 *
 * Idempotent by the outbox's own unique idempotency key: a duplicate render, a
 * React double effect or an offline retry that finally reaches the server
 * resolves to the same row instead of piling up presentations.
 */
export function startPresentation(
  db: DatabaseInstance,
  input: StartPresentationInput
): Presentation {
  const scope = `presentation:${input.tenantId}:${input.idempotencyKey}`;

  const existing = db
    .select()
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.tenantId, input.tenantId),
        eq(paymentOutbox.kind, 'presentation'),
        eq(paymentOutbox.idempotencyKey, scope)
      )
    )
    .get();
  if (existing) return toPresentation(existing);

  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'A presentation needs an amount' });
  }

  const id = nanoid();
  const now = new Date().toISOString();
  const currencyCode = resolveTenantCurrency(db, input.tenantId);

  db.transaction(tx => {
    tx.insert(paymentOutbox)
      .values({
        id,
        tenantId: input.tenantId,
        // No rail: a static QR is shown, never charged through a provider.
        railId: 'static_qr',
        kind: 'presentation',
        status: 'presented',
        amount,
        currencyCode,
        reference: input.idempotencyKey,
        payload: {
          source: 'register',
          siteId: input.siteId,
          startedBy: input.userId,
          destination: input.destination,
        },
        attempts: 0,
        idempotencyKey: scope,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    writeAuditLog({
      tx,
      tenantId: input.tenantId,
      actorId: input.userId,
      action: 'payment.presentation_started',
      resourceType: 'sale',
      resourceId: id,
      before: null,
      after: {
        amount,
        currencyCode,
        siteId: input.siteId,
        destination: input.destination,
      },
      ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    });
  });

  return {
    id,
    tenantId: input.tenantId,
    siteId: input.siteId,
    amount,
    currencyCode,
    destination: input.destination,
    status: 'presented',
    startedBy: input.userId,
    createdAt: now,
  };
}

/** Read one presentation inside its tenant. */
export function getPresentation(
  db: DatabaseInstance,
  tenantId: string,
  presentationId: string
): Presentation {
  const row = db
    .select()
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.id, presentationId),
        eq(paymentOutbox.tenantId, tenantId),
        eq(paymentOutbox.kind, 'presentation')
      )
    )
    .get();
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Presentation not found' });
  }
  return toPresentation(row);
}

/**
 * Attach a presentation to the sale that finally happened.
 *
 * Cheap to get wrong in a way nobody notices, so every fact is re-checked
 * server-side: same tenant, same site, and an amount that still matches what
 * the customer was shown. A presentation is a single-use record: linking twice
 * is refused rather than silently re-pointed at a second sale.
 */
export function linkPresentationToSale(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    presentationId: string;
    siteId: string;
    amount: number;
    saleId: string;
    salePaymentId: string | null;
    actorId: string;
    operationId?: string | undefined;
  }
): Presentation {
  const presentation = getPresentation(db, args.tenantId, args.presentationId);

  if (presentation.status === 'linked') {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This presentation is already linked to a sale',
    });
  }
  if (presentation.status === 'closed_admin') {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This presentation was closed administratively',
    });
  }
  if (presentation.siteId !== args.siteId) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The presentation belongs to another site',
    });
  }
  if (Math.abs(roundMoney(presentation.amount) - roundMoney(args.amount)) >= 0.005) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The sale amount does not match the amount the customer was shown',
    });
  }

  const now = new Date().toISOString();
  db.transaction(tx => {
    tx.update(paymentOutbox)
      .set({
        status: 'linked',
        salePaymentId: args.salePaymentId,
        payload: {
          source: 'register',
          siteId: presentation.siteId,
          startedBy: presentation.startedBy,
          destination: presentation.destination,
          saleId: args.saleId,
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(paymentOutbox.id, args.presentationId),
          eq(paymentOutbox.tenantId, args.tenantId),
          eq(paymentOutbox.status, 'presented')
        )
      )
      .run();
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'payment.presentation_linked',
      resourceType: 'sale',
      resourceId: args.presentationId,
      before: { status: presentation.status },
      after: { status: 'linked', saleId: args.saleId, salePaymentId: args.salePaymentId },
      ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
    });
  });

  return { ...presentation, status: 'linked' };
}

/**
 * Close a presentation administratively, with a note.
 *
 * The record is never deleted: an expired presentation might still have been
 * paid, so it stays visible and reconcilable for as long as anyone cares to
 * look.
 */
export function closePresentationAdmin(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    presentationId: string;
    actorId: string;
    note: string;
    operationId?: string | undefined;
  }
): Presentation {
  const presentation = getPresentation(db, args.tenantId, args.presentationId);
  if (presentation.status === 'linked') {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'A linked presentation cannot be closed administratively',
    });
  }

  const now = new Date().toISOString();
  db.transaction(tx => {
    tx.update(paymentOutbox)
      .set({ status: 'closed_admin', updatedAt: now })
      .where(
        and(
          eq(paymentOutbox.id, args.presentationId),
          eq(paymentOutbox.tenantId, args.tenantId),
          eq(paymentOutbox.kind, 'presentation')
        )
      )
      .run();
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'payment.presentation_closed_admin',
      resourceType: 'sale',
      resourceId: args.presentationId,
      before: { status: presentation.status },
      after: { status: 'closed_admin', note: args.note },
      ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
    });
  });

  return { ...presentation, status: 'closed_admin' };
}

/**
 * Expire presentations nobody linked within the TTL.
 *
 * Expiry is local and harmless: the customer's bank may still move money, so
 * the row keeps its `timeout` state and stays reconcilable. It is only
 * excluded from "still open right now" lists.
 */
export function expirePresentations(
  db: DatabaseInstance,
  args: { now?: Date; ttlMs?: number } = {}
): number {
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - (args.ttlMs ?? PRESENTATION_TTL_MS)).toISOString();

  const expired = db
    .select({ id: paymentOutbox.id })
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.kind, 'presentation'),
        eq(paymentOutbox.status, 'presented'),
        lt(paymentOutbox.createdAt, cutoff)
      )
    )
    .all();
  if (expired.length === 0) return 0;

  db.update(paymentOutbox)
    .set({ status: 'timeout', updatedAt: now.toISOString() })
    .where(
      and(
        eq(paymentOutbox.kind, 'presentation'),
        eq(paymentOutbox.status, 'presented'),
        lt(paymentOutbox.createdAt, cutoff)
      )
    )
    .run();
  return expired.length;
}

/** Presentations still open for one site, for the register and reconciliation. */
export function listOpenPresentations(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): Presentation[] {
  return db
    .select()
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.tenantId, tenantId),
        eq(paymentOutbox.kind, 'presentation'),
        eq(paymentOutbox.status, 'presented')
      )
    )
    .all()
    .map(toPresentation)
    .filter(presentation => presentation.siteId === siteId);
}

/**
 * Link a presentation inside the sale transaction that creates its tender.
 *
 * Deliberately not `linkPresentationToSale`: that one opens its own
 * transaction, which is right for a standalone endpoint and wrong here. Called
 * from inside the sale, a mismatched presentation must abort the whole sale —
 * a charged sale beside an open presentation is the one state that would make
 * the till disagree with the bank silently.
 *
 * `timeout` links too: an expired presentation is exactly the late payment
 * reconciliation exists for.
 */
export function linkPresentationToTender(
  tx: Pick<DatabaseInstance, 'update'>,
  args: {
    tenantId: string;
    saleId: string;
    salePaymentId: string;
    presentationId: string;
    amount: number;
  }
): void {
  const presentation = (tx as unknown as DatabaseInstance)
    .select()
    .from(paymentOutbox)
    .where(
      and(
        eq(paymentOutbox.id, args.presentationId),
        eq(paymentOutbox.tenantId, args.tenantId),
        eq(paymentOutbox.kind, 'presentation')
      )
    )
    .get();
  if (!presentation) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Presentation ${args.presentationId} does not belong to this tenant`,
    });
  }
  if (Math.abs(roundMoney(presentation.amount) - roundMoney(args.amount)) >= 0.005) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'The presentation amount does not match the tender being charged',
    });
  }

  const now = new Date().toISOString();
  const result = tx
    .update(paymentOutbox)
    .set({
      status: 'linked',
      salePaymentId: args.salePaymentId,
      payload: {
        ...(presentation.payload ?? {}),
        saleId: args.saleId,
      },
      updatedAt: now,
    })
    .where(
      and(
        eq(paymentOutbox.id, args.presentationId),
        eq(paymentOutbox.tenantId, args.tenantId),
        eq(paymentOutbox.kind, 'presentation'),
        sql`${paymentOutbox.status} IN ('presented', 'timeout')`
      )
    )
    .run();

  if (Number(result.changes) !== 1) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This presentation was already linked or closed; reopen the QR and charge again',
    });
  }
}
