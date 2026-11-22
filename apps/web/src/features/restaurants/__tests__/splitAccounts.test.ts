import { describe, expect, it } from 'vitest';
import {
  canSplitByDiner,
  moveTargetIndex,
  planForMove,
  splitAccountsFromTableState,
} from '../splitAccounts';

type TableState = Parameters<typeof splitAccountsFromTableState>[0];

function line(saleItemId: string, dinerId: string | null, total = 1_000) {
  return {
    id: `line-${saleItemId}`,
    saleItemId,
    dinerId,
    productName: `Plato ${saleItemId}`,
    quantity: 1,
    total,
  };
}

function tableState(checks: Array<{ id: string; lines: ReturnType<typeof line>[] }>): TableState {
  return {
    service: { id: 'service-1' },
    diners: [
      { id: 'd-1', seatNumber: 1 },
      { id: 'd-2', seatNumber: 2 },
      { id: 'd-3', seatNumber: 3 },
    ],
    checks: checks.map((check, index) => ({
      id: check.id,
      saleId: `sale-${check.id}`,
      saleNumber: `VTA-${index + 1}`,
      label: 'Mesa 7',
      suspendedAt: '2026-11-21T19:00:00.000Z',
      total: check.lines.reduce((sum, row) => sum + row.total, 0),
      lines: check.lines,
    })),
  } as unknown as TableState;
}

describe('splitAccountsFromTableState', () => {
  const state = tableState([
    { id: 'c-late', lines: [line('x', 'd-3'), line('y', null)] },
    { id: 'c-early', lines: [line('a', 'd-2'), line('b', 'd-1')] },
  ]);

  it('reads by first diner with shared plates last, then adds the empty accounts', () => {
    const accounts = splitAccountsFromTableState(state, 1);
    expect(accounts.map(account => account.checkId)).toEqual(['c-early', 'c-late', null]);
    expect(accounts[0]?.seats).toEqual([1, 2]);
    expect(accounts[1]?.seats).toEqual([3, null]);
    expect(accounts[2]).toMatchObject({ lines: [], total: 0, saleId: null });
  });

  it('keeps a pinned order and puts unknown checks last', () => {
    const accounts = splitAccountsFromTableState(state, 0, ['c-late']);
    expect(accounts.map(account => account.checkId)).toEqual(['c-late', 'c-early']);
  });

  it('is empty without an open service', () => {
    expect(splitAccountsFromTableState(undefined, 2)).toEqual([]);
  });
});

describe('moveTargetIndex', () => {
  it('sends a plate to the next account and the last account back', () => {
    expect(moveTargetIndex(0, 2)).toBe(1);
    expect(moveTargetIndex(1, 2)).toBe(0);
    expect(moveTargetIndex(1, 3)).toBe(2);
  });
});

describe('planForMove', () => {
  it('lists every line once, keeps an emptied check and opens a new account', () => {
    const accounts = splitAccountsFromTableState(
      tableState([{ id: 'c-1', lines: [line('a', 'd-1')] }]),
      1
    );
    expect(planForMove(accounts, 'a', 1)).toEqual([
      { checkId: 'c-1', saleItemIds: [] },
      { checkId: null, saleItemIds: ['a'] },
    ]);
  });

  it('drops empty accounts that never received a plate', () => {
    const accounts = splitAccountsFromTableState(
      tableState([
        { id: 'c-1', lines: [line('a', 'd-1'), line('b', 'd-2')] },
        { id: 'c-2', lines: [line('c', 'd-3')] },
      ]),
      1
    );
    expect(planForMove(accounts, 'a', 1)).toEqual([
      { checkId: 'c-1', saleItemIds: ['b'] },
      { checkId: 'c-2', saleItemIds: ['c', 'a'] },
    ]);
  });
});

describe('canSplitByDiner', () => {
  it('needs two groups and is off once each account holds one', () => {
    const one = splitAccountsFromTableState(
      tableState([{ id: 'c-1', lines: [line('a', 'd-1'), line('b', 'd-1')] }]),
      0
    );
    expect(canSplitByDiner(one)).toBe(false);

    const mixed = splitAccountsFromTableState(
      tableState([{ id: 'c-1', lines: [line('a', 'd-1'), line('b', null)] }]),
      0
    );
    expect(canSplitByDiner(mixed)).toBe(true);

    const split = splitAccountsFromTableState(
      tableState([
        { id: 'c-1', lines: [line('a', 'd-1')] },
        { id: 'c-2', lines: [line('b', null)] },
      ]),
      1
    );
    expect(canSplitByDiner(split)).toBe(false);
  });
});
