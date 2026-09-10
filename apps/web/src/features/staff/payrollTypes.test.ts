import { describe, expect, it } from 'vitest';
import {
  isPayrollWindow,
  parsePayrollMoney,
  payrollHoursToSeconds,
  payrollPeriodDateIssue,
} from './payrollTypes';

describe('payroll UI value parsing', () => {
  it('accepts real half-open calendar windows without normalizing invalid dates', () => {
    expect(isPayrollWindow('2026-08-01', '2026-09-01')).toBe(true);
    expect(isPayrollWindow('2026-08-01', '')).toBe(true);
    expect(isPayrollWindow('2026-02-30', '2026-03-01')).toBe(false);
    expect(isPayrollWindow('2026-08-01', '2026-08-01')).toBe(false);
  });

  it('mirrors the transport period ordering and maximum span', () => {
    expect(payrollPeriodDateIssue('2026-08-01', '2026-09-01', '2026-09-05')).toBeNull();
    expect(payrollPeriodDateIssue('2026-08-01', '2026-08-01', '2026-08-01')).toBe('window');
    expect(payrollPeriodDateIssue('2026-08-01', '2026-09-02', '2026-09-05')).toBe('periodSpan');
    expect(payrollPeriodDateIssue('2026-08-01', '2026-09-01', '2026-07-31')).toBe('payDate');
  });

  it('converts only exact whole-second hours and strict two-decimal money', () => {
    expect(payrollHoursToSeconds('7.5')).toBe(27_000);
    expect(payrollHoursToSeconds('0.0001')).toBeNull();
    expect(payrollHoursToSeconds('1e2')).toBeNull();
    expect(parsePayrollMoney('125.40')).toBe(125.4);
    expect(parsePayrollMoney('125.404')).toBeNull();
  });
});
