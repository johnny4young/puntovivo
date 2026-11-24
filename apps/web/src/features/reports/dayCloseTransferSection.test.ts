import { describe, expect, it } from 'vitest';
import { deriveDayCloseTransferSection, type DayCloseTransferConfirmations } from './dayCloseTransferSection';

function block(
  overrides: Partial<DayCloseTransferConfirmations> = {}
): DayCloseTransferConfirmations {
  return {
    saleTotal: 400_000,
    reported: 350_000,
    confirmed: 200_000,
    pending: 100_000,
    rejected: 30_000,
    legacy: 20_000,
    unapplied: 15_000,
    superseded: 25_000,
    notApplied: {
      count: 2,
      amount: 52_000,
      byReason: {
        tender_rejected: { count: 1, amount: 40_000 },
        tender_cancelled: { count: 0, amount: 0 },
        other: { count: 1, amount: 12_000 },
      },
    },
    destinations: [
      {
        destinationId: 'dest-bank',
        label: 'Bancolombia ****1234',
        kind: 'bank_account',
        confirmed: 200_000,
        pending: 100_000,
        count: 3,
        references: ['REF-2', 'REF-7'],
      },
      {
        destinationId: null,
        label: null,
        kind: null,
        confirmed: 0,
        pending: 50_000,
        count: 1,
        references: [],
      },
    ],
    ...overrides,
  };
}

describe('deriveDayCloseTransferSection', () => {
  it('renders nothing at all when the served block is absent', () => {
    expect(deriveDayCloseTransferSection(undefined)).toBeNull();
    expect(deriveDayCloseTransferSection(null)).toBeNull();
  });

  it('keeps every transfer figure its own value in contract order', () => {
    const view = deriveDayCloseTransferSection(block());
    expect(view?.figures).toEqual([
      { key: 'saleTotal', amount: 400_000 },
      { key: 'reported', amount: 350_000 },
      { key: 'confirmed', amount: 200_000 },
      { key: 'pending', amount: 100_000 },
      { key: 'rejected', amount: 30_000 },
      { key: 'legacy', amount: 20_000 },
      { key: 'unapplied', amount: 15_000 },
      { key: 'superseded', amount: 25_000 },
    ]);
  });

  it('leaves out superseded when an older snapshot does not carry it', () => {
    const { superseded: _superseded, notApplied: _notApplied, ...older } = block();
    const view = deriveDayCloseTransferSection(older);
    expect(view?.figures.map(figure => figure.key)).toEqual([
      'saleTotal',
      'reported',
      'confirmed',
      'pending',
      'rejected',
      'legacy',
      'unapplied',
    ]);
    expect(view?.notApplied).toBeNull();
    expect(view?.destinations).toHaveLength(2);
    expect(view?.hasTransfers).toBe(true);
  });

  it('reads the not-applied bucket with its reason split', () => {
    const view = deriveDayCloseTransferSection(block());
    expect(view?.notApplied).toEqual({
      count: 2,
      amount: 52_000,
      byReason: [
        { reason: 'tender_rejected', count: 1, amount: 40_000 },
        { reason: 'tender_cancelled', count: 0, amount: 0 },
        { reason: 'other', count: 1, amount: 12_000 },
      ],
    });
  });

  it('hides the not-applied bucket when nothing was received against a dead tender', () => {
    const view = deriveDayCloseTransferSection(
      block({
        notApplied: {
          count: 0,
          amount: 0,
          byReason: {
            tender_rejected: { count: 0, amount: 0 },
            tender_cancelled: { count: 0, amount: 0 },
            other: { count: 0, amount: 0 },
          },
        },
      })
    );
    expect(view?.notApplied).toBeNull();
  });

  it('keeps the frozen destination label and its bank references', () => {
    const view = deriveDayCloseTransferSection(block());
    expect(view?.destinations).toEqual([
      {
        key: 'dest-bank',
        label: 'Bancolombia ****1234',
        confirmed: 200_000,
        pending: 100_000,
        count: 3,
        references: ['REF-2', 'REF-7'],
      },
      {
        key: 'unlabelled-1',
        label: null,
        confirmed: 0,
        pending: 50_000,
        count: 1,
        references: [],
      },
    ]);
  });

  it('recognises a day without transfers even when the block is present', () => {
    const view = deriveDayCloseTransferSection({
      saleTotal: 0,
      reported: 0,
      confirmed: 0,
      pending: 0,
      rejected: 0,
      legacy: 0,
      unapplied: 0,
      superseded: 0,
      notApplied: {
        count: 0,
        amount: 0,
        byReason: {
          tender_rejected: { count: 0, amount: 0 },
          tender_cancelled: { count: 0, amount: 0 },
          other: { count: 0, amount: 0 },
        },
      },
      destinations: [],
    });
    expect(view?.hasTransfers).toBe(false);
  });

  it('recognises transfers from the destination split alone', () => {
    const view = deriveDayCloseTransferSection({
      saleTotal: 0,
      reported: 0,
      confirmed: 0,
      pending: 0,
      rejected: 0,
      legacy: 0,
      unapplied: 0,
      destinations: [
        {
          destinationId: 'dest-cash',
          label: 'Caja',
          kind: 'cash',
          confirmed: 0,
          pending: 0,
          count: 1,
          references: [],
        },
      ],
    });
    expect(view?.hasTransfers).toBe(true);
  });
});
