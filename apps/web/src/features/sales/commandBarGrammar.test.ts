import { describe, expect, it } from 'vitest';
import {
  MAX_COMMAND_QUANTITY,
  parseCommandBarMode,
  parseQuantityPrefix,
  quantityFitsProduct,
} from './commandBarGrammar';

describe('parseQuantityPrefix', () => {
  it.each([
    ['3*', 3, ''],
    ['12*', 12, ''],
    [' 3 *leche', 3, 'leche'],
    ['3* arroz diana', 3, 'arroz diana'],
    ['0,485*', 0.485, ''],
    ['1.5*', 1.5, ''],
  ])('reads %j as quantity %d', (raw, quantity, rest) => {
    expect(parseQuantityPrefix(raw)).toEqual({ quantity, rest });
  });

  it.each(['3', '*3', 'x3', '3x', 'abc*', '0*', '0,000*', '10000*', '1,2345*', '@3*', ''])(
    'ignores %j',
    raw => {
      expect(parseQuantityPrefix(raw)).toBeNull();
    }
  );

  it('accepts the cap itself', () => {
    expect(parseQuantityPrefix(`${MAX_COMMAND_QUANTITY}*`)?.quantity).toBe(MAX_COMMAND_QUANTITY);
  });
});

describe('parseCommandBarMode', () => {
  it('treats plain text as a product search', () => {
    expect(parseCommandBarMode(' arroz ')).toEqual({ kind: 'search', query: 'arroz' });
    expect(parseCommandBarMode('7702001')).toEqual({ kind: 'search', query: '7702001' });
  });

  it('reads @ as a customer search', () => {
    expect(parseCommandBarMode('@')).toEqual({ kind: 'customer', query: '' });
    expect(parseCommandBarMode('@ maría ')).toEqual({ kind: 'customer', query: 'maría' });
  });

  it('reads / as an action filter', () => {
    expect(parseCommandBarMode('/')).toEqual({ kind: 'action', query: '' });
    expect(parseCommandBarMode('/susp')).toEqual({ kind: 'action', query: 'susp' });
  });

  it('only reads a prefix at the start', () => {
    expect(parseCommandBarMode('pan @ casa').kind).toBe('search');
    expect(parseCommandBarMode('1/2 libra').kind).toBe('search');
  });
});

describe('quantityFitsProduct', () => {
  it('allows decimals only for fraction products', () => {
    expect(quantityFitsProduct(3, { sellByFraction: false })).toBe(true);
    expect(quantityFitsProduct(0.5, { sellByFraction: false })).toBe(false);
    expect(quantityFitsProduct(0.5, { sellByFraction: true })).toBe(true);
  });
});
