import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductFormValues } from '@/features/products/ProductFormModal';
import { createDefaultValues } from '@/features/products/productForm.helpers';
import { useQuickCreateStore } from './useQuickCreateStore';

const {
  createMutateAsyncMock,
  listInvalidateMock,
  searchInvalidateMock,
  readinessInvalidateMock,
  productFormPropsRef,
  advancedQueryEnabledMock,
  vatQueryEnabledMock,
} = vi.hoisted(() => ({
  createMutateAsyncMock: vi.fn(),
  listInvalidateMock: vi.fn(),
  searchInvalidateMock: vi.fn(),
  readinessInvalidateMock: vi.fn(),
  advancedQueryEnabledMock: vi.fn(),
  vatQueryEnabledMock: vi.fn(),
  productFormPropsRef: {
    current: null as null | {
      onSubmit: (values: ProductFormValues) => Promise<unknown>;
      defaultName?: string;
      initialExperience?: 'quick' | 'advanced';
      origin?: 'catalog' | 'sale';
      onExperienceChange?: (experience: 'quick' | 'advanced') => void;
      pharmacyMode?: boolean;
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/features/products/ProductFormModal', () => ({
  ProductFormModal: (props: {
    onSubmit: (values: ProductFormValues) => Promise<unknown>;
    defaultName?: string;
    initialExperience?: 'quick' | 'advanced';
    origin?: 'catalog' | 'sale';
    onExperienceChange?: (experience: 'quick' | 'advanced') => void;
    pharmacyMode?: boolean;
  }) => {
    productFormPropsRef.current = props;
    return <div data-testid="quick-create-product-modal" />;
  },
}));

const emptyQuery = { data: { items: [] }, isLoading: false };

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      products: {
        list: { invalidate: listInvalidateMock },
        search: { invalidate: searchInvalidateMock },
      },
      setupReadiness: {
        firstSale: { invalidate: readinessInvalidateMock },
      },
    }),
    categories: {
      tree: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          advancedQueryEnabledMock(options.enabled);
          return emptyQuery;
        },
      },
    },
    providers: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          advancedQueryEnabledMock(options.enabled);
          return emptyQuery;
        },
      },
    },
    locations: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          advancedQueryEnabledMock(options.enabled);
          return emptyQuery;
        },
      },
    },
    units: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          advancedQueryEnabledMock(options.enabled);
          return emptyQuery;
        },
      },
    },
    vatRates: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          vatQueryEnabledMock(options.enabled);
          return emptyQuery;
        },
      },
    },
    products: {
      create: {
        useMutation: () => ({
          mutateAsync: createMutateAsyncMock,
          reset: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

import { QuickCreateProductGate } from './QuickCreateProductGate';

describe('QuickCreateProductGate', () => {
  beforeEach(() => {
    act(() => {
      useQuickCreateStore.getState().reset();
      useQuickCreateStore.getState().requestCreateProduct({ defaultName: 'Producto rápido' });
    });
    createMutateAsyncMock.mockReset();
    listInvalidateMock.mockReset();
    searchInvalidateMock.mockReset();
    readinessInvalidateMock.mockReset();
    advancedQueryEnabledMock.mockReset();
    vatQueryEnabledMock.mockReset();
    productFormPropsRef.current = null;
    createMutateAsyncMock.mockResolvedValue({ id: 'product-created' });
    listInvalidateMock.mockResolvedValue(undefined);
    searchInvalidateMock.mockResolvedValue(undefined);
    readinessInvalidateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      useQuickCreateStore.getState().reset();
    });
  });

  it('normalizes the form payload before creating and invalidates all quick-create reads', async () => {
    render(<QuickCreateProductGate />);

    expect(productFormPropsRef.current?.defaultName).toBe('Producto rápido');
    expect(productFormPropsRef.current?.initialExperience).toBe('quick');
    expect(productFormPropsRef.current?.origin).toBe('sale');

    const values = {
      ...createDefaultValues(),
      name: 'Producto rápido',
      sku: 'RAP-001',
      description: '',
      providerId: 'provider-secondary',
      unitAssignments: [],
      providerAssignments: [{ providerId: 'provider-primary' }],
    };

    await act(async () => {
      await productFormPropsRef.current?.onSubmit(values);
    });

    expect(createMutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Producto rápido',
        sku: 'RAP-001',
        description: null,
        providerId: 'provider-secondary',
        fractionStep: null,
        fractionMinimum: null,
        providerAssignments: [
          { providerId: 'provider-secondary' },
          { providerId: 'provider-primary' },
        ],
      })
    );
    expect(createMutateAsyncMock.mock.calls[0]?.[0]).not.toHaveProperty('unitAssignments');
    expect(listInvalidateMock).toHaveBeenCalledOnce();
    expect(searchInvalidateMock).toHaveBeenCalledOnce();
    expect(readinessInvalidateMock).toHaveBeenCalledOnce();
  });

  it('loads only tax choices until the operator requests advanced settings', () => {
    render(<QuickCreateProductGate />);

    expect(advancedQueryEnabledMock).toHaveBeenCalledTimes(4);
    expect(advancedQueryEnabledMock.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(vatQueryEnabledMock).toHaveBeenLastCalledWith(true);

    act(() => {
      productFormPropsRef.current?.onExperienceChange?.('advanced');
    });

    expect(advancedQueryEnabledMock.mock.calls.slice(-4).every(([enabled]) => enabled === true)).toBe(
      true
    );
  });

  it('opens the complete regulated form and lookup catalogs for a pharmacy tenant', () => {
    render(<QuickCreateProductGate pharmacyMode />);

    expect(productFormPropsRef.current?.initialExperience).toBe('advanced');
    expect(productFormPropsRef.current?.pharmacyMode).toBe(true);
    expect(advancedQueryEnabledMock.mock.calls.every(([enabled]) => enabled === true)).toBe(true);
  });

  it('returns the handled-error sentinel when the product mutation rejects', async () => {
    createMutateAsyncMock.mockRejectedValue(new Error('duplicate SKU'));
    render(<QuickCreateProductGate />);

    let result: unknown;
    await act(async () => {
      result = await productFormPropsRef.current?.onSubmit({
        ...createDefaultValues(),
        name: 'Producto duplicado',
        sku: 'DUP-001',
      });
    });

    expect(result).toBeUndefined();
    expect(listInvalidateMock).not.toHaveBeenCalled();
    expect(searchInvalidateMock).not.toHaveBeenCalled();
    expect(readinessInvalidateMock).not.toHaveBeenCalled();
  });

  it('propagates post-create invalidation failures instead of hiding them', async () => {
    listInvalidateMock.mockRejectedValue(new Error('cache invalidation failed'));
    render(<QuickCreateProductGate />);

    await act(async () => {
      await expect(
        productFormPropsRef.current?.onSubmit({
          ...createDefaultValues(),
          name: 'Producto creado',
          sku: 'NEW-001',
        })
      ).rejects.toThrow('cache invalidation failed');
    });
  });
});
