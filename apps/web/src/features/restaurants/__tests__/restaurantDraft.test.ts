import { describe, expect, it } from 'vitest';
import {
  getRestaurantModifierPriceDelta,
  hasDuplicateRestaurantModifiers,
  restaurantModifierSnapshot,
} from '../restaurantDraft';

describe('restaurantDraft', () => {
  it('rounds each add-on like the server and ignores blank rows in monetary snapshots', () => {
    const modifiers = [
      { id: 'a', name: ' Cheese ', quantity: 3, unitPriceDelta: 0.005 },
      { id: 'b', name: 'Salt', quantity: 2, unitPriceDelta: 0.335 },
      { id: 'c', name: '  ', quantity: 20, unitPriceDelta: 999 },
    ];
    expect(restaurantModifierSnapshot(modifiers)).toEqual([
      { name: 'Cheese', quantity: 3, unitPriceDelta: 0.01 },
      { name: 'Salt', quantity: 2, unitPriceDelta: 0.34 },
    ]);
    expect(getRestaurantModifierPriceDelta(modifiers)).toBe(0.71);
    expect(
      hasDuplicateRestaurantModifiers([
        ...modifiers,
        { id: 'd', name: '', quantity: 1, unitPriceDelta: 0 },
      ])
    ).toBe(false);
    expect(
      hasDuplicateRestaurantModifiers([
        ...modifiers,
        { id: 'e', name: 'SALT', quantity: 1, unitPriceDelta: 0 },
      ])
    ).toBe(true);
  });

  it('sends the group only with the catalog option it came from', () => {
    expect(
      restaurantModifierSnapshot([
        {
          id: 'a',
          catalogId: 'o-1',
          catalogVersion: 2,
          groupId: 'g-1',
          groupKind: 'without',
          name: 'Onion',
          quantity: 1,
          unitPriceDelta: 0,
        },
        { id: 'b', groupId: 'g-1', name: 'Custom', quantity: 1, unitPriceDelta: 500 },
      ])
    ).toEqual([
      {
        catalogId: 'o-1',
        catalogVersion: 2,
        groupId: 'g-1',
        name: 'Onion',
        quantity: 1,
        unitPriceDelta: 0,
      },
      { name: 'Custom', quantity: 1, unitPriceDelta: 500 },
    ]);
  });
});
