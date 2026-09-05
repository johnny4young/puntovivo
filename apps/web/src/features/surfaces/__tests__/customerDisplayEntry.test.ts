import { describe, expect, it } from 'vitest';
import { isCustomerDisplayEntryLocation } from '../customerDisplayEntry';

describe('isCustomerDisplayEntryLocation', () => {
  it('recognizes independently loaded browser and packaged routes', () => {
    expect(isCustomerDisplayEntryLocation({ pathname: '/customer-display', hash: '' })).toBe(true);
    expect(
      isCustomerDisplayEntryLocation({
        pathname: '/index.html',
        hash: '#/customer-display?access=11111111-1111-4111-8111-111111111111',
      })
    ).toBe(true);
  });

  it('does not isolate ordinary application routes', () => {
    expect(isCustomerDisplayEntryLocation({ pathname: '/sales', hash: '' })).toBe(false);
    expect(isCustomerDisplayEntryLocation({ pathname: '/index.html', hash: '#/sales' })).toBe(
      false
    );
  });
});
