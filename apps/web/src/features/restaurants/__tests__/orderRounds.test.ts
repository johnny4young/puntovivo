import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { modifierSummary } from '../orderRounds';

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
