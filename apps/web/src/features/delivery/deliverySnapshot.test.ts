import { describe, expect, it } from 'vitest';
import { formatDeliveryAmount, parseDeliveryItems } from './deliverySnapshot';

describe('Delivery snapshot display safety', () => {
  it.each([
    null,
    '',
    '{broken',
    '{}',
    '[null]',
    '[{"name": {"x": 1}, "qty": 1, "unitPrice": 2}]',
    '[{"name":"Line","qty":-1,"unitPrice":2}]',
    '[{"name":"Line","qty":1,"unitPrice":1e999}]',
  ])('rejects malformed history without crashing the renderer: %s', value => {
    expect(parseDeliveryItems(value)).toEqual([]);
  });
  it('preserves text rather than interpreting HTML', () => {
    const item = { name: '<script>alert(1)</script>', qty: 0.125, unitPrice: 10 };
    expect(parseDeliveryItems(JSON.stringify([item]))).toEqual([item]);
  });
  it('preserves maximum catalog names and never invents legacy currency', () => {
    const item = { name: 'A'.repeat(255), qty: 1, unitPrice: 10 };
    expect(parseDeliveryItems(JSON.stringify([item]))).toEqual([item]);
    expect(formatDeliveryAmount(10, null, 'Currency unknown')).toBe('10.00 · Currency unknown');
    expect(formatDeliveryAmount(10, 'invalid', 'Currency unknown')).toBe(
      '10.00 · Currency unknown'
    );
  });
  it('bounds history before rendering', () => {
    expect(parseDeliveryItems(' '.repeat(256001))).toEqual([]);
    expect(
      parseDeliveryItems(
        JSON.stringify(Array.from({ length: 201 }, () => ({ name: 'Line', qty: 1, unitPrice: 1 })))
      )
    ).toEqual([]);
  });
});
