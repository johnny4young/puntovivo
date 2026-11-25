import { describe, expect, it } from 'vitest';
import { readRestaurantChargeEntry } from './restaurantChargeEntry';

describe('readRestaurantChargeEntry', () => {
  it('reads the account a split sheet asked to charge', () => {
    expect(
      readRestaurantChargeEntry({
        restaurantCharge: { id: 's-1', tableId: 't-7', label: 'Mesa 7', suspendedAt: 'x' },
      })
    ).toEqual({
      id: 's-1',
      tableId: 't-7',
      label: 'Mesa 7',
      suspendedAt: 'x',
      resumedDeviceId: null,
    });
  });

  it('ignores any other history state', () => {
    expect(readRestaurantChargeEntry(null)).toBeNull();
    expect(readRestaurantChargeEntry({ omniboxQuery: 'pan' })).toBeNull();
    expect(readRestaurantChargeEntry({ restaurantCharge: { id: ' ', tableId: 't' } })).toBeNull();
    expect(readRestaurantChargeEntry({ restaurantCharge: { id: 's-1' } })).toBeNull();
  });
});
