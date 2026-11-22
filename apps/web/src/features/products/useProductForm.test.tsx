import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProductForm } from './useProductForm';

describe('useProductForm submit contract', () => {
  it('preserves an independently priced base-unit assignment during product repricing', async () => {
    const { result } = renderHook(() =>
      useProductForm({
        mode: 'create',
        product: null,
        onSubmit: vi.fn(),
      })
    );

    await act(async () => {
      result.current.form.setValue('price', 100);
      result.current.form.setValue('unitAssignments', [
        {
          unitId: 'unit-independent',
          barcode: '',
          equivalence: 1,
          price: 75,
          price2: 65,
          price3: 55,
          isBase: true,
        },
      ]);
      result.current.syncTier('price', 'marginPercent1', 'marginAmount1', { price: 120 });
      await Promise.resolve();
    });

    expect(result.current.form.getValues('price')).toBe(120);
    expect(result.current.form.getValues('unitAssignments.0.price')).toBe(75);
  });

  it('keeps a typed price when the cost is typed afterwards and leaves empty tiers at 0', async () => {
    const { result } = renderHook(() =>
      useProductForm({ mode: 'create', product: null, onSubmit: vi.fn() })
    );

    await act(async () => {
      result.current.syncTier('price', 'marginPercent1', 'marginAmount1', { price: 5000 });
      result.current.syncAllTiersFromCost(3000);
      await Promise.resolve();
    });

    const values = result.current.form.getValues();
    expect(values.price).toBe(5000);
    expect(values.marginAmount1).toBe(2000);
    expect(values.marginPercent1).toBeCloseTo(66.67);
    expect([values.price2, values.price3]).toEqual([0, 0]);
    expect([values.marginPercent2, values.marginAmount2]).toEqual([0, 0]);
    expect(values.initialCost).toBe(3000);
  });

  it('reprices from cost only for a tier whose margin the operator typed', async () => {
    const { result } = renderHook(() =>
      useProductForm({ mode: 'create', product: null, onSubmit: vi.fn() })
    );

    await act(async () => {
      result.current.syncAllTiersFromCost(1000);
      result.current.syncTier('price', 'marginPercent1', 'marginAmount1', { marginPercent: 50 });
      result.current.syncTier('price2', 'marginPercent2', 'marginAmount2', { price: 1400 });
      result.current.syncAllTiersFromCost(2000);
      await Promise.resolve();
    });

    const values = result.current.form.getValues();
    expect(values.price).toBe(3000);
    expect(values.marginPercent1).toBe(50);
    expect(values.price2).toBe(1400);
    expect(values.marginPercent2).toBe(0);
  });

  it('stops mirroring cost into initial cost once initial cost is typed apart', async () => {
    const { result } = renderHook(() =>
      useProductForm({ mode: 'create', product: null, onSubmit: vi.fn() })
    );

    await act(async () => {
      result.current.syncAllTiersFromCost(1000);
      result.current.form.setValue('initialCost', 900);
      result.current.syncAllTiersFromCost(1200);
      await Promise.resolve();
    });

    expect(result.current.form.getValues('initialCost')).toBe(900);
  });

  it('propagates unexpected submit failures to observability', async () => {
    const failure = new Error('post-submit callback failed');
    const onSubmit = vi.fn().mockRejectedValue(failure);
    const { result } = renderHook(() =>
      useProductForm({
        mode: 'create',
        product: null,
        onSubmit,
      })
    );

    act(() => {
      result.current.form.setValue('name', 'Producto');
      result.current.form.setValue('sku', 'PROD-001');
    });

    await act(async () => {
      await expect(result.current.handleSubmit()).rejects.toBe(failure);
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('does not fire onCreated for the explicit handled-error sentinel', async () => {
    const onCreated = vi.fn();
    const { result } = renderHook(() =>
      useProductForm({
        mode: 'create',
        product: null,
        onSubmit: vi.fn().mockResolvedValue(undefined),
        onCreated,
      })
    );

    act(() => {
      result.current.form.setValue('name', 'Producto');
      result.current.form.setValue('sku', 'PROD-002');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('reports only the aggregate invalid-submit signal without exposing field values', async () => {
    const onInvalid = vi.fn();
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useProductForm({
        mode: 'create',
        product: null,
        onSubmit,
        onInvalid,
      })
    );
    act(() => {
      result.current.form.register('name', { required: true });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onInvalid).toHaveBeenCalledWith();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
