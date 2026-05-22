/**
 * ENG-105c — Coverage for `useQuickCreateStore`.
 *
 * Pins the lifecycle invariants: independent slots, single-shot
 * consume that resets the slot, reset() that wipes both, and stable
 * selector references across renders.
 *
 * @module features/sales/useQuickCreateStore.test
 */

import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  selectRequestedCreateCustomer,
  selectRequestedCreateProduct,
  useQuickCreateStore,
} from './useQuickCreateStore';

afterEach(() => {
  useQuickCreateStore.getState().reset();
});

describe('useQuickCreateStore', () => {
  it('starts with both slots null', () => {
    const state = useQuickCreateStore.getState();
    expect(state.requestedCreateProduct).toBeNull();
    expect(state.requestedCreateCustomer).toBeNull();
  });

  it('requestCreateProduct fills the product slot leaving customer untouched', () => {
    useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'Arroz Diana' });
    const state = useQuickCreateStore.getState();
    expect(state.requestedCreateProduct).toEqual({ defaultName: 'Arroz Diana' });
    expect(state.requestedCreateCustomer).toBeNull();
  });

  it('requestCreateCustomer fills the customer slot leaving product untouched', () => {
    useQuickCreateStore.getState().requestCreateCustomer({ defaultName: 'Acme Distribuidora' });
    const state = useQuickCreateStore.getState();
    expect(state.requestedCreateCustomer).toEqual({ defaultName: 'Acme Distribuidora' });
    expect(state.requestedCreateProduct).toBeNull();
  });

  it('consumeCreateProduct returns the request and clears the slot', () => {
    useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'A' });
    const result = useQuickCreateStore.getState().consumeCreateProduct();
    expect(result).toEqual({ defaultName: 'A' });
    expect(useQuickCreateStore.getState().requestedCreateProduct).toBeNull();
  });

  it('consumeCreateProduct returns null when nothing is queued and does not flip state', () => {
    const result = useQuickCreateStore.getState().consumeCreateProduct();
    expect(result).toBeNull();
    expect(useQuickCreateStore.getState().requestedCreateProduct).toBeNull();
  });

  it('consumeCreateCustomer mirrors the consume contract', () => {
    useQuickCreateStore.getState().requestCreateCustomer({ defaultName: 'Walk-in' });
    const result = useQuickCreateStore.getState().consumeCreateCustomer();
    expect(result).toEqual({ defaultName: 'Walk-in' });
    expect(useQuickCreateStore.getState().requestedCreateCustomer).toBeNull();
  });

  it('reset clears both slots in one call', () => {
    useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'p' });
    useQuickCreateStore.getState().requestCreateCustomer({ defaultName: 'c' });
    useQuickCreateStore.getState().reset();
    const state = useQuickCreateStore.getState();
    expect(state.requestedCreateProduct).toBeNull();
    expect(state.requestedCreateCustomer).toBeNull();
  });

  it('overwrites a pending request when called twice without consuming', () => {
    useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'first' });
    useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'second' });
    expect(useQuickCreateStore.getState().requestedCreateProduct).toEqual({
      defaultName: 'second',
    });
  });

  it('selectRequestedCreateProduct returns the live slot value', () => {
    const { result, rerender } = renderHook(() =>
      useQuickCreateStore(selectRequestedCreateProduct)
    );
    expect(result.current).toBeNull();

    useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'X' });
    rerender();
    expect(result.current).toEqual({ defaultName: 'X' });
  });

  it('selectRequestedCreateCustomer returns the live slot value', () => {
    const { result, rerender } = renderHook(() =>
      useQuickCreateStore(selectRequestedCreateCustomer)
    );
    expect(result.current).toBeNull();

    useQuickCreateStore.getState().requestCreateCustomer({ defaultName: 'Walk-in' });
    rerender();
    expect(result.current).toEqual({ defaultName: 'Walk-in' });
  });

  it('accepts null defaultName for the palette dispatch path', () => {
    useQuickCreateStore.getState().requestCreateProduct({ defaultName: null });
    const result = useQuickCreateStore.getState().consumeCreateProduct();
    expect(result).toEqual({ defaultName: null });
  });
});
