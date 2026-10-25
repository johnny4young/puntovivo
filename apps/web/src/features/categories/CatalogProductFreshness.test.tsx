import { act, cleanup, render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  callbacks: new Map<string, { onSuccess: () => Promise<void> }>(),
  invalidated: [] as string[],
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/components/resources/ResourcePage', () => ({ ResourcePage: () => null }));
vi.mock('@/components/form-controls/Modal', () => ({ ConfirmModal: () => null, Modal: () => null }));
vi.mock('@/features/providers/ProviderCategoryAssignmentsModal', () => ({
  ProviderCategoryAssignmentsModal: () => null,
}));
vi.mock('@/lib/trpc', () => {
  // Any procedure path resolves to a query, a mutation or an invalidatable utils node.
  const node = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key: string) => {
        if (key === 'useQuery') return () => ({ data: undefined, isLoading: false });
        if (key === 'useMutation')
          return (options: { onSuccess: () => Promise<void> }) => {
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

afterEach(() => {
  cleanup();
  state.callbacks.clear();
  state.invalidated.length = 0;
});

describe('catalog metadata edits refresh product projections', () => {
  const pages: Array<[string, ComponentType]> = [
    ['categories', CategoriesPage],
    ['providers', ProvidersPage],
    ['locations', LocationsPage],
    ['vatRates', VatRatesPage],
    ['units', UnitsPage],
  ];

  for (const [router, Page] of pages) {
    it(`invalidates every product query after a ${router} update`, async () => {
      render(<Page />);
      const update = state.callbacks.get(`${router}.update`);
      expect(update).toBeDefined();

      await act(() => update!.onSuccess());

      expect(state.invalidated).toContain('products');
    });
  }
});
