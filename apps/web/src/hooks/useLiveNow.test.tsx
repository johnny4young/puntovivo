import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { resolveLotBusinessDate, useLiveNow } from './useLiveNow';

describe('useLiveNow', () => {
  it('resolves a lot business date and fails closed for an invalid tenant zone or clock', () => {
    expect(resolveLotBusinessDate(Date.parse('2026-09-26T00:30:00.000Z'), 'America/Bogota')).toBe(
      '2026-09-25'
    );
    expect(resolveLotBusinessDate(Date.now(), 'Unsupported/Legacy_Zone')).toBeNull();
    expect(resolveLotBusinessDate(Number.NaN, 'America/Bogota')).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('advances once per visible minute and stops the clock after unmount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T04:59:30.000Z'));
    const { result, unmount } = renderHook(() => useLiveNow());
    expect(result.current.now).toBe(Date.parse('2026-09-26T04:59:30.000Z'));
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.now).toBe(Date.parse('2026-09-26T05:00:30.000Z'));

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not poll a hidden register and catches up on visibility recovery', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T04:59:30.000Z'));
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const { result } = renderHook(() => useLiveNow());

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.now).toBe(Date.parse('2026-09-26T04:59:30.000Z'));

    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(result.current.now).toBe(Date.parse('2026-09-26T05:00:30.000Z'));
  });
});
