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
