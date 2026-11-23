import { describe, expect, it } from 'vitest';

import {
  canTransition,
  isTransferAwaitingConfirmation,
  isTransferConfirmed,
  isTransferSuperseded,
  resolveInitialTransferState,
  sumSaleTenders,
  transferConfirmationColumns,
} from './transfer-confirmation.js';
import { planTransferAdjustment } from './transfer-adjustment.js';

describe('transfer confirmation lifecycle', () => {
  it('treats a NULL (historical) transfer as received and superseded-never', () => {
    expect(isTransferConfirmed(null)).toBe(true);
    expect(isTransferConfirmed(undefined)).toBe(true);
    expect(isTransferSuperseded(null)).toBe(false);
    expect(isTransferAwaitingConfirmation(null)).toBe(false);
  });

  it('keeps reported, pending and unreconciled transfers out of received', () => {
    for (const status of ['pending', 'customer_reported', 'needs_reconciliation'] as const) {
      expect(isTransferConfirmed(status)).toBe(false);
      expect(isTransferSuperseded(status)).toBe(false);
      expect(isTransferAwaitingConfirmation(status)).toBe(true);
    }
  });

  it('counts only the effective confirmations as received', () => {
    expect(isTransferConfirmed('manual_confirmed')).toBe(true);
    expect(isTransferConfirmed('provider_confirmed')).toBe(true);
  });

  it('treats rejected and cancelled as superseded', () => {
    for (const status of ['rejected', 'cancelled'] as const) {
      expect(isTransferSuperseded(status)).toBe(true);
      expect(isTransferConfirmed(status)).toBe(false);
      expect(isTransferAwaitingConfirmation(status)).toBe(false);
    }
  });

  it('forbids the transitions the owner called out', () => {
    // Reported money cannot be cancelled as if it never left the customer.
    expect(canTransition('customer_reported', 'cancelled')).toMatchObject({ allowed: false });
    // A confirmation never becomes a rejection through a normal mutation.
    expect(canTransition('manual_confirmed', 'rejected')).toMatchObject({
      allowed: false,
      reason: 'terminal',
    });
    expect(canTransition('provider_confirmed', 'rejected')).toMatchObject({ allowed: false });
    // Late authentic verdicts reopen into reconciliation, never straight to
    // confirmed.
    expect(canTransition('rejected', 'manual_confirmed')).toMatchObject({ allowed: false });
    expect(canTransition('rejected', 'provider_confirmed')).toMatchObject({ allowed: false });
    expect(canTransition('rejected', 'needs_reconciliation')).toMatchObject({ allowed: true });
    expect(canTransition('cancelled', 'needs_reconciliation')).toMatchObject({ allowed: true });
    // Historical rows have no outgoing transition.
    expect(canTransition(null, 'manual_confirmed')).toMatchObject({ allowed: false });
  });

  it('allows the documented happy paths', () => {
    expect(canTransition('pending', 'customer_reported').allowed).toBe(true);
    expect(canTransition('pending', 'manual_confirmed').allowed).toBe(true);
    expect(canTransition('pending', 'provider_confirmed').allowed).toBe(true);
    expect(canTransition('needs_reconciliation', 'provider_confirmed').allowed).toBe(true);
    expect(canTransition('customer_reported', 'provider_confirmed').allowed).toBe(true);
  });

  it('never writes a new transfer without a state', () => {
    const withReference = resolveInitialTransferState({
      method: 'transfer',
      reference: 'NQU-8899',
    });
    // Preserves today's behaviour: the cashier already verified and typed it.
    expect(withReference).toMatchObject({
      confirmationStatus: 'manual_confirmed',
      confirmationSource: 'operator',
      isConfirmedAtCreation: true,
    });

    const withoutReference = resolveInitialTransferState({ method: 'transfer', reference: '  ' });
    expect(withoutReference).toMatchObject({
      confirmationStatus: 'pending',
      confirmationSource: null,
      isConfirmedAtCreation: false,
    });

    // The lifecycle is transfer-only.
    for (const method of ['cash', 'card', 'credit', 'loyalty', 'store_credit', 'other']) {
      expect(resolveInitialTransferState({ method, reference: 'X' }).confirmationStatus).toBeNull();
    }
  });

  it('stamps actor and time only for an effective confirmation', () => {
    const confirmed = transferConfirmationColumns({
      method: 'transfer',
      reference: 'NQU-1',
      actorId: 'user-1',
      now: '2026-11-22T10:00:00.000Z',
    });
    expect(confirmed).toEqual({
      confirmationStatus: 'manual_confirmed',
      confirmationSource: 'operator',
      confirmedBy: 'user-1',
      confirmedAt: '2026-11-22T10:00:00.000Z',
    });

    const pending = transferConfirmationColumns({
      method: 'transfer',
      reference: null,
      actorId: 'user-1',
      now: '2026-11-22T10:00:00.000Z',
    });
    expect(pending.confirmedBy).toBeNull();
    expect(pending.confirmedAt).toBeNull();

    const cash = transferConfirmationColumns({
      method: 'cash',
      reference: null,
      actorId: 'user-1',
      now: '2026-11-22T10:00:00.000Z',
    });
    expect(cash.confirmationStatus).toBeNull();
    expect(cash.confirmedBy).toBeNull();
  });
});

describe('sumSaleTenders', () => {
  it('keeps active tenders equal to the sale total while excluding unreceived money', () => {
    // $100 sale: $40 cash + $60 transfer reported by the customer.
    const sums = sumSaleTenders([
      { method: 'cash', amount: 40 },
      { method: 'transfer', amount: 60, confirmationStatus: 'customer_reported' },
    ]);

    expect(sums.activeTotal).toBe(100);
    expect(sums.receivedTotal).toBe(40);
    expect(sums.awaitingTotal).toBe(60);
    expect(sums.supersededTotal).toBe(0);
  });

  it('excludes superseded tenders from every sum', () => {
    const sums = sumSaleTenders([
      { method: 'cash', amount: 40 },
      { method: 'transfer', amount: 60, confirmationStatus: 'rejected' },
      { method: 'transfer', amount: 50, confirmationStatus: 'manual_confirmed' },
      { method: 'transfer', amount: 10, confirmationStatus: 'pending' },
    ]);

    expect(sums.activeTotal).toBe(100);
    expect(sums.receivedTotal).toBe(90);
    expect(sums.awaitingTotal).toBe(10);
    expect(sums.supersededTotal).toBe(60);
  });

  it('counts a historical NULL transfer as received', () => {
    const sums = sumSaleTenders([
      { method: 'transfer', amount: 60, confirmationStatus: null },
      { method: 'cash', amount: 40 },
    ]);
    expect(sums.receivedTotal).toBe(100);
    expect(sums.awaitingTotal).toBe(0);
  });

  it('reaches paid once the second instalment is confirmed', () => {
    const partial = sumSaleTenders([
      { method: 'cash', amount: 40 },
      { method: 'transfer', amount: 30, confirmationStatus: 'manual_confirmed' },
      { method: 'transfer', amount: 30, confirmationStatus: 'pending' },
    ]);
    expect(partial.receivedTotal).toBe(70);

    const paid = sumSaleTenders([
      { method: 'cash', amount: 40 },
      { method: 'transfer', amount: 60, confirmationStatus: 'manual_confirmed' },
    ]);
    expect(paid.receivedTotal).toBe(100);
    expect(paid.awaitingTotal).toBe(0);
  });
});

describe('planTransferAdjustment', () => {
  it('splits a $60 expected tender into $50 received plus $10 pending', () => {
    const plan = planTransferAdjustment({
      saleTotal: 100,
      tenders: [
        { method: 'cash', amount: 40, reference: null },
        { method: 'transfer', amount: 60, reference: null },
      ],
      targetIndex: 1,
      verifiedAmount: 50,
      reference: 'NQU-8899',
    });

    expect(plan.appliedAmount).toBe(50);
    expect(plan.remainingAmount).toBe(10);
    expect(plan.surplusAmount).toBe(0);
    expect(plan.activeTotal).toBe(100);
    expect(plan.matchesSaleTotal).toBe(true);
    expect(plan.tenders).toEqual([
      { method: 'cash', amount: 40, reference: null },
      {
        method: 'transfer',
        amount: 50,
        reference: 'NQU-8899',
        confirmationStatus: 'manual_confirmed',
        confirmationSource: 'operator',
      },
      { method: 'transfer', amount: 10, reference: null, confirmationStatus: 'pending', confirmationSource: null },
    ]);
  });

  it('applies a surplus to the sale and reports the rest separately', () => {
    const plan = planTransferAdjustment({
      saleTotal: 100,
      tenders: [
        { method: 'cash', amount: 40, reference: null },
        { method: 'transfer', amount: 60, reference: null },
      ],
      targetIndex: 1,
      verifiedAmount: 70,
      reference: 'NQU-1',
    });

    expect(plan.appliedAmount).toBe(60);
    expect(plan.remainingAmount).toBe(0);
    expect(plan.surplusAmount).toBe(10);
    expect(plan.activeTotal).toBe(100);
    expect(plan.matchesSaleTotal).toBe(true);
  });

  it('accumulates two legitimate instalments into one paid sale', () => {
    const first = planTransferAdjustment({
      saleTotal: 100,
      tenders: [
        { method: 'cash', amount: 40, reference: null },
        { method: 'transfer', amount: 60, reference: null },
      ],
      targetIndex: 1,
      verifiedAmount: 30,
      reference: 'A',
    });
    expect(first.activeTotal).toBe(100);
    expect(first.remainingAmount).toBe(30);

    // Second instalment applies to the $30 row the first plan left pending.
    const second = planTransferAdjustment({
      saleTotal: 100,
      tenders: first.tenders,
      targetIndex: 2,
      verifiedAmount: 30,
      reference: 'B',
    });
    expect(second.remainingAmount).toBe(0);
    expect(second.activeTotal).toBe(100);
    expect(second.matchesSaleTotal).toBe(true);

    const finalSums = sumSaleTenders(
      second.tenders.map(tender => ({
        method: tender.method,
        amount: tender.amount,
        confirmationStatus: tender.confirmationStatus ?? null,
      }))
    );
    expect(finalSums.receivedTotal).toBe(100);
    expect(finalSums.awaitingTotal).toBe(0);
  });

  it('rejects a non-positive verified amount instead of silently confirming zero', () => {
    expect(() =>
      planTransferAdjustment({
        saleTotal: 100,
        tenders: [{ method: 'transfer', amount: 60, reference: null }],
        targetIndex: 0,
        verifiedAmount: 0,
        reference: 'X',
      })
    ).toThrow(/positive verified amount/);
  });
});
