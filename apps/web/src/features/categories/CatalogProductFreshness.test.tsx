import { act, cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_METADATA_INVALIDATIONS, type TrpcUtils } from '@/lib/invalidateGroups';

type MutationOptions = {
  onSuccess: () => Promise<void>;
  onError?: (error: unknown) => void;
};

const state = vi.hoisted(() => ({
  callbacks: new Map<string, MutationOptions>(),
  invalidated: [] as string[],
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/components/resources/ResourcePage', () => ({ ResourcePage: () => null }));
vi.mock('@/components/form-controls/Modal', () => ({
  ConfirmModal: () => null,
  Modal: () => null,
}));
vi.mock('@/features/providers/ProviderCategoryAssignmentsModal', () => ({
  ProviderCategoryAssignmentsModal: () => null,
}));
vi.mock('@/lib/trpc', () => {
  // Any procedure path resolves to a query, a mutation or an invalidatable utils node.
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (typeof key !== 'string' || key === 'then') return undefined;
        if (key === 'useQuery') return () => ({ data: undefined, isLoading: false });
        if (key === 'useMutation')
          return (options: MutationOptions) => {
            state.callbacks.set(path.join('.'), options);
            return { mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
          };
        if (key === 'invalidate')
          return async () => {
            state.invalidated.push(path.join('.'));
          };
        if (key === 'useUtils') return () => node([]);
        return node([...path, key]);
      },
    });
  return { trpc: node([]) };
});

import { CategoriesPage } from './CategoriesPage';
import { LocationsPage } from '../locations/LocationsPage';
import { ProvidersPage } from '../providers/ProvidersPage';
import { UnitsPage } from '../units/UnitsPage';
import { VatRatesPage } from '../vat-rates/VatRatesPage';

function pickerPath(pick: (typeof CATALOG_METADATA_INVALIDATIONS)[number]): string {
  const segments: string[] = [];
  const recorder: unknown = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'invalidate') return () => Promise.resolve();
        segments.push(String(key));
        return recorder;
      },
    }
  );
  pick(recorder as TrpcUtils);
  return segments.join('.');
}

const catalogReads = CATALOG_METADATA_INVALIDATIONS.map(pickerPath);
const staleVersionError = { data: { errorCode: 'STALE_VERSION' } };

afterEach(() => {
  cleanup();
  state.callbacks.clear();
  state.invalidated.length = 0;
});

describe('catalog metadata edits refresh every read that joins the name', () => {
  const pages: Array<[string, ComponentType]> = [
    ['categories', CategoriesPage],
    ['providers', ProvidersPage],
    ['locations', LocationsPage],
    ['vatRates', VatRatesPage],
    ['units', UnitsPage],
  ];

  it('covers the product, inventory, purchasing and sales reads', () => {
    expect(catalogReads).toEqual(
      expect.arrayContaining([
        'products.list',
        'products.getById',
        'inventory',
        'purchases',
        'sales',
      ])
    );
    expect(catalogReads).not.toContain('products.semanticSearch');
  });

  for (const [router, Page] of pages) {
    it(`invalidates the catalog reads after a ${router} update`, async () => {
      render(<Page />);
      const update = state.callbacks.get(`${router}.update`);
      expect(update).toBeDefined();

      await act(() => update!.onSuccess());

      expect(state.invalidated).toEqual(expect.arrayContaining(catalogReads));
      expect(state.invalidated).toContain(`${router}.${router === 'categories' ? 'tree' : 'list'}`);
    });
  }

  for (const [router, Page] of pages.slice(0, 2)) {
    it(`invalidates the catalog reads after a ${router} STALE_VERSION conflict`, async () => {
      render(<Page />);

      await act(async () => state.callbacks.get(`${router}.update`)!.onError?.(staleVersionError));

      expect(state.invalidated).toEqual(expect.arrayContaining(catalogReads));
    });
  }
});
