import { lazy, Suspense, useMemo, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DataTableColumnDef } from '@/components/tables/DataTable';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { Badge } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { Provider } from '@/types';

const ProviderPayablesModal = lazy(() =>
  import('./ProviderPayablesModal').then(module => ({
    default: module.ProviderPayablesModal,
  }))
);

/**
 * Manager-safe supplier-account directory. Provider CRUD remains on the
 * admin-only /providers route; this page exposes only the payable ledger.
 */
export function ProviderAccountsPage() {
  const { t: tSettings } = useTranslation('settings');
  const { t: tPayables } = useTranslation('providerPayables');
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 200);
  const providersQuery = trpc.providers.list.useQuery(
    {
      page: 1,
      perPage: 100,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    },
    { placeholderData: keepPreviousData }
  );
  const providers = (providersQuery.data?.items ?? []).map(provider => ({
    ...provider,
    isActive: provider.isActive ?? false,
  })) as Provider[];
  const columns = useMemo<DataTableColumnDef<Provider>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tSettings('providers.columns.name'),
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">
              {row.original.contactName || tSettings('providers.columns.noContact')}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'taxId',
        header: tSettings('providers.columns.taxId'),
        cell: ({ row }) => row.original.taxId || '—',
      },
      {
        accessorKey: 'email',
        header: tSettings('providers.columns.email'),
        cell: ({ row }) => row.original.email || '—',
      },
      {
        accessorKey: 'isActive',
        header: tSettings('providers.columns.status'),
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
            {row.original.isActive
              ? tSettings('common:status.active')
              : tSettings('common:status.inactive')}
          </Badge>
        ),
      },
      {
        id: 'account',
        header: tPayables('directory.column'),
        cell: ({ row }) => (
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            aria-label={tPayables('directory.openLabel', { provider: row.original.name })}
            onClick={() => setSelectedProvider(row.original)}
          >
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
            {tPayables('directory.open')}
          </button>
        ),
      },
    ],
    [tPayables, tSettings]
  );

  return (
    <>
      <ResourcePage
        title={tPayables('directory.title')}
        description={tPayables('directory.description')}
        action={null}
        columns={columns}
        data={providers}
        isLoading={providersQuery.isLoading}
        error={
          providersQuery.error
            ? translateServerError(
                providersQuery.error,
                tSettings,
                tSettings('errors:server.unknown')
              )
            : null
        }
        searchPlaceholder={tSettings('providers.search')}
        searchValue={search}
        onSearchChange={setSearch}
        enableRowSelection={false}
        loadingMessage={tSettings('providers.loading')}
        onRetry={() => void providersQuery.refetch()}
        onRowActivate={setSelectedProvider}
      />

      {selectedProvider && (
        <Suspense fallback={null}>
          <ProviderPayablesModal
            key={selectedProvider.id}
            isOpen
            provider={selectedProvider}
            onClose={() => setSelectedProvider(null)}
          />
        </Suspense>
      )}
    </>
  );
}
