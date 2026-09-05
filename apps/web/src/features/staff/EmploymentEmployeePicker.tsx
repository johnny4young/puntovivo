import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';

/** Bounded active-user picker includes viewer workers without changing their access privileges. */
export function EmploymentEmployeePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation(['workforce', 'errors']);
  const [search, setSearch] = useState('');
  const searchTerm = useDebouncedValue(search, 250);
  const searchPending = searchTerm !== search;
  const [page, setPage] = useState(1);
  const [selectedName, setSelectedName] = useState('');
  const query = trpc.users.list.useQuery(
    { page, perPage: 20, search: searchTerm, isActive: true },
    { gcTime: 0 }
  );
  const items = query.data?.items ?? [];
  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="block">
        <span className="label">{t('employeeSearch')}</span>
        <input
          className="input mt-1"
          type="search"
          value={search}
          disabled={disabled}
          onChange={event => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      <label className="block">
        <span className="label">{t('employee')}</span>
        <select
          className="input mt-1"
          value={value}
          disabled={disabled || searchPending || query.isFetching || !!query.error}
          onChange={event => {
            setSelectedName(items.find(item => item.id === event.target.value)?.name ?? '');
            onChange(event.target.value);
          }}
        >
          <option value="">{t('chooseEmployee')}</option>
          {value && !items.some(item => item.id === value) && (
            <option value={value}>{selectedName}</option>
          )}
          {items.map(item => (
            <option key={item.id} value={item.id}>
              {item.name} · {t(`roles.${item.role}`)}
            </option>
          ))}
        </select>
      </label>
      {query.isFetching && <p role="status">{t('loading')}</p>}
      {query.error && (
        <div role="alert">
          <p>{translateServerError(query.error, t, t('loadError'))}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      )}
      {query.data && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={disabled || searchPending || page <= 1 || query.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t('previousEmployees')}
          </Button>
          <span className="text-xs text-secondary-500">
            {t('employeePage', { page, total: Math.max(1, query.data.totalPages) })}
          </span>
          <Button
            variant="outline"
            disabled={
              disabled || searchPending || page >= query.data.totalPages || query.isFetching
            }
            onClick={() => setPage(page + 1)}
          >
            {t('nextEmployees')}
          </Button>
        </div>
      )}
    </div>
  );
}
