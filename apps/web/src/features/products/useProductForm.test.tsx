import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useProductForm } from './useProductForm';

describe('useProductForm submit contract', () => {
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

    await expect(result.current.handleSubmit()).rejects.toBe(failure);
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

    await result.current.handleSubmit();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
