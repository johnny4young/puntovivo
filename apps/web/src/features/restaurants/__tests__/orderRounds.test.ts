import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { modifierSummary, sentRoundsFromTableState } from '../orderRounds';

describe('modifierSummary', () => {
  it('reads a plate the way the kitchen does', async () => {
    await i18n.changeLanguage('es');
    expect(
      modifierSummary(i18n.t, [
        { name: 'Tres cuartos', quantity: 1, unitPriceDelta: 0, groupKind: 'choice' },
        { name: 'Chicharrón', quantity: 1, unitPriceDelta: 0, groupKind: 'without' },
        { name: 'Aguacate', quantity: 2, unitPriceDelta: 4000, groupKind: 'extra' },
        { name: 'Velas', quantity: 1, unitPriceDelta: 2000, groupKind: null },
        { name: 'Sin hielo', quantity: 1, unitPriceDelta: 0, groupKind: null },
      ])
    ).toBe('Tres cuartos · sin Chicharrón · + 2× Aguacate · + Velas · Sin hielo');
  });
});

describe('sentRoundsFromTableState', () => {
  it('keeps plates without a round in one early round after a split', () => {
    const plate = (id: string) => ({
      id,
      roundId: null,
      dinerId: null,
      quantity: 1,
      productName: id,
      total: 1_000,
      notes: null,
      modifiers: [],
    });
    const rounds = sentRoundsFromTableState({
      service: { id: 'service-1' },
      diners: [],
      checks: [
        {
          id: 'c-1',
          label: null,
          openedAt: '2026-11-21T19:00:00.000Z',
          rounds: [],
          lines: [plate('a')],
        },
        // A check opened by the split carries the move time, not the order time.
        {
          id: 'c-2',
          label: null,
          openedAt: '2026-11-21T21:30:00.000Z',
          rounds: [],
          lines: [plate('b')],
        },
      ],
    } as unknown as Parameters<typeof sentRoundsFromTableState>[0]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ sequence: 1, sentAt: '2026-11-21T19:00:00.000Z' });
    expect(rounds[0]?.lines.map(line => line.productName)).toEqual(['a', 'b']);
  });
});
