import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe('useMediaQuery', () => {
  it('follows the media query as it changes', () => {
    let listener: (() => void) | undefined;
    const list = {
      matches: false,
      addEventListener: (_: string, fn: () => void) => (listener = fn),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => list as unknown as MediaQueryList);
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);

    list.matches = true;
    act(() => listener?.());
    expect(result.current).toBe(true);
    unmount();
    expect(list.removeEventListener).toHaveBeenCalled();
  });

  it('uses the fallback without matchMedia', () => {
    // @ts-expect-error simulating an environment without matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)', true));
    expect(result.current).toBe(true);
  });
});
