/**
 * The guard behind the money modals' submit paths.
 *
 * `Modal` renders `footer` as a sibling of `children`, so a modal whose body
 * is a `<form>` keeps its confirm button OUTSIDE that form: `disabled` on the
 * button is not on the submit path at all. Anything that dispatches a submit
 * event directly — implicit submission from Enter, `requestSubmit()`, or a
 * submit button someone later adds inside the form — reaches the handler with
 * the button's disabled state never consulted.
 *
 * Two halves, because a single flag cannot cover both windows: `canSubmit` is
 * a render-captured state value and cannot see a second dispatch inside the
 * same task; the ref flips synchronously and cannot see the parent's pending
 * state after the callback itself has resolved.
 *
 * @module lib/__tests__/useSingleFlightSubmit.test
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSingleFlightSubmit } from '../useSingleFlightSubmit';

/** A promise whose settlement the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSingleFlightSubmit', () => {
  it('runs the callback and returns its value when allowed', async () => {
    const submit = vi.fn(async (amount: number) => amount * 2);
    const { result } = renderHook(() => useSingleFlightSubmit(true, submit));

    await expect(result.current(21)).resolves.toBe(42);
    expect(submit).toHaveBeenCalledExactlyOnceWith(21);
  });

  it('declines silently while the caller says it cannot submit', async () => {
    const submit = vi.fn();
    const { result } = renderHook(() => useSingleFlightSubmit(false, submit));

    await expect(result.current()).resolves.toBeUndefined();
    expect(submit).not.toHaveBeenCalled();
  });

  it('collapses concurrent dispatches into one call', async () => {
    // The defect this exists for. `isSaving` is a state value: two submits
    // dispatched before React re-renders both read the pre-update `false`,
    // so the render-captured half alone would let both through. Held Enter
    // on a repeating keyboard is exactly this, over and over.
    const gate = deferred<string>();
    const submit = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useSingleFlightSubmit(true, submit));

    let first!: Promise<string | undefined>;
    let second!: Promise<string | undefined>;
    act(() => {
      first = result.current();
      second = result.current();
    });

    expect(submit).toHaveBeenCalledOnce();
    await act(async () => {
      gate.resolve('written');
    });
    await expect(first).resolves.toBe('written');
    await expect(second).resolves.toBeUndefined();
  });

  it('reopens once the callback settles, so a second deliberate write works', async () => {
    const submit = vi.fn(async () => 'ok');
    const { result } = renderHook(() => useSingleFlightSubmit(true, submit));

    await result.current();
    await result.current();
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('reopens after a rejection, so a failed write stays retryable', async () => {
    // A guard that latched on failure would strand the operator on a network
    // blip with no way to retry except closing and reopening the modal.
    const submit = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('ok');
    const { result } = renderHook(() => useSingleFlightSubmit(true, submit));

    await expect(result.current()).rejects.toThrow('network');
    await expect(result.current()).resolves.toBe('ok');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('honours the latest canSubmit without re-mounting', async () => {
    const submit = vi.fn();
    const { result, rerender } = renderHook(
      ({ canSubmit }) => useSingleFlightSubmit(canSubmit, submit),
      { initialProps: { canSubmit: true } }
    );

    rerender({ canSubmit: false });
    await result.current();
    expect(submit).not.toHaveBeenCalled();

    rerender({ canSubmit: true });
    await result.current();
    expect(submit).toHaveBeenCalledOnce();
  });

  it('calls the latest callback, so callers need no memoization', async () => {
    // Every modal passes a fresh arrow each render. If the hook captured the
    // first one, the guard would silently submit stale closures — worse than
    // the bug it replaces.
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ submit }) => useSingleFlightSubmit(true, submit), {
      initialProps: { submit: first },
    });

    rerender({ submit: second });
    await result.current();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps the in-flight state across renders', () => {
    // The wrapper itself is a fresh closure per render — `form.handleSubmit`
    // is too — but the flag it consults must survive, or a re-render landing
    // mid-write (the parent flipping `isSaving`, which is guaranteed to
    // happen) would reopen the window it exists to close.
    const gate = new Promise<void>(() => {});
    const submit = vi.fn(() => gate);
    const { result, rerender } = renderHook(
      ({ canSubmit }) => useSingleFlightSubmit(canSubmit, submit),
      {
        initialProps: { canSubmit: true },
      }
    );

    void result.current();
    rerender({ canSubmit: true });
    void result.current();
    expect(submit).toHaveBeenCalledOnce();
  });
});
