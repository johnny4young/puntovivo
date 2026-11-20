import { describe, expect, it } from 'vitest';
import { roundMoney } from '@/lib/money';
import { cashChange, serviceChargeFor, suggestCashTenders } from './cashTender';

describe('suggestCashTenders', () => {
  it('offers the next two round bills above the total', () => {
    expect(suggestCashTenders(87_420)).toEqual([90_000, 100_000]);
    expect(suggestCashTenders(23_400)).toEqual([30_000, 50_000]);
    expect(suggestCashTenders(4_500)).toEqual([5_000, 10_000]);
    expect(suggestCashTenders(109_400)).toEqual([110_000, 150_000]);
    expect(suggestCashTenders(12.34)).toEqual([13, 15]);
  });

  it('never repeats the exact total', () => {
    expect(suggestCashTenders(90_000)).toEqual([100_000, 200_000]);
    expect(suggestCashTenders(50_000)).toEqual([100_000, 200_000]);
  });

  it('returns nothing without a positive total', () => {
    expect(suggestCashTenders(0)).toEqual([]);
    expect(suggestCashTenders(-10)).toEqual([]);
    expect(suggestCashTenders(Number.NaN)).toEqual([]);
  });

  it('honours the requested count', () => {
    expect(suggestCashTenders(87_420, 1)).toEqual([90_000]);
  });
});

describe('cashChange', () => {
  it('matches roundMoney on the tender minus the total', () => {
    expect(cashChange(90_000, 87_420)).toBe(2_580);
    expect(cashChange(100_000, 87_420)).toBe(12_580);
    expect(cashChange(20, 12.34)).toBe(roundMoney(20 - 12.34));
    expect(cashChange(20, 12.34)).toBe(7.66);
    expect(cashChange(0.3, 0.1)).toBe(0.2);
  });

  it('is zero for an exact or short tender', () => {
    expect(cashChange(87_420, 87_420)).toBe(0);
    expect(cashChange(50_000, 87_420)).toBe(0);
  });
});

describe('serviceChargeFor', () => {
  it('rounds the charge to cents and is zero when the rate is off', () => {
    expect(serviceChargeFor(87_420, 10)).toBe(8_742);
    expect(serviceChargeFor(12.35, 10)).toBe(1.24);
    expect(serviceChargeFor(87_420, 0)).toBe(0);
  });
});
