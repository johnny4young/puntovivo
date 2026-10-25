import { act, cleanup, render } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  callbacks: {} as Record<string, { onSuccess: () => Promise<void> }>,
  invalidateProducts: vi.fn<() => Promise<void>>(),
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
vi.mock('@/features/providers/providerColumns', () => ({ createProviderColumns: () => [] }));
vi.mock('@/lib/trpc', () => {
  const query = { useQuery: () => ({ data: { items: [] }, isLoading: false }) };
  const invalidatable = { invalidate: async () => undefined };
  const mutation = (key: string) => ({
    useMutation: (options: { onSuccess: () => Promise<void> }) => {
      state.callbacks[key] = options;
      return { reset: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({
        products: { invalidate: state.invalidateProducts },
        categories: { tree: invalidatable, list: invalidatable },
        providers: { list: invalidatable, listCategoryAssignments: invalidatable },
      }),
      categories: {
        tree: query,
        create: mutation('category.create'),
        update: mutation('category.update'),
        delete: mutation('category.delete'),
      },
      providers: {
        list: query,
        listCategoryAssignments: query,
        create: mutation('provider.create'),
        update: mutation('provider.update'),
        delete: mutation('provider.delete'),
        replaceCategoryAssignments: mutation('provider.assign'),
      },
      cities: { list: query },
    },
  };
});
import { CategoriesPage } from './CategoriesPage';
import { ProvidersPage } from '../providers/ProvidersPage';

let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 300_000, retry: false } } });
  state.invalidateProducts.mockImplementation(() =>
    client.invalidateQueries({ queryKey: ['products'] })
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

describe('successful metadata edits refresh product read projections', () => {
  for (const [entity, Page] of [
    ['category', CategoriesPage],
    ['provider', ProvidersPage],
  ] as const) {
    it(`refreshes fresh list variants and cached detail after ${entity} rename`, async () => {
      let serverName = 'Original name';
      const keys = [
        ['products', 'list', { page: 1 }],
        ['products', 'list', { search: 'probe' }],
        ['products', 'getById', { id: 'probe' }],
      ];
      const fetch = (queryKey: readonly unknown[]) =>
        client.fetchQuery({ queryKey, queryFn: async () => serverName });
      for (const key of keys) expect(await fetch(key)).toBe('Original name');
      await client.fetchQuery({ queryKey: ['customers'], queryFn: async () => 'Unrelated cache' });
      render(<Page />);
      serverName = 'Renamed metadata';
      // Within staleTime a normal mount/fetch would otherwise reuse the old projection.
      expect(await fetch(keys[0]!)).toBe('Original name');
      await act(async () => state.callbacks[`${entity}.update`]!.onSuccess());
      for (const key of keys) expect(await fetch(key)).toBe('Renamed metadata');
      expect(client.getQueryState(['customers'])?.isInvalidated).toBe(false);
    });
  }
});
