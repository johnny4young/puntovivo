import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';

/** Dedicated manager-safe picker: never calls the administrator-only users directory. */
export function WorkforceEmployeePicker({
  value,
  onChange,
  disabled,
  domain,
  selectedLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  domain: 'timeOff' | 'availability' | 'schedulePlans';
  selectedLabel?: string;
}) {
  const { t } = useTranslation(['workforce', 'errors', 'workforceErrors']);
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search, 250);
  const [cursors, setCursors] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const query = trpc.workforce[domain].employees.useQuery(
    { search: term, limit: 20, ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}) },
    { gcTime: 0, staleTime: 0 }
  );
  const items = query.data?.items ?? [],
    pending = search !== term || query.isFetching;
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="label">{t('employeeSearch')}</span>
        <input
          className="input"
          type="search"
          value={search}
          disabled={disabled}
          onChange={event => {
            setSearch(event.target.value);
            setCursors([]);
          }}
        />
      </label>
      <label className="block">
        <span className="label">{t('employee')}</span>
        <select
          className="input"
          value={value}
          disabled={disabled || pending || !!query.error}
          onChange={event => {
            setSelectedName(items.find(item => item.id === event.target.value)?.name ?? '');
            onChange(event.target.value);
          }}
        >
          <option value="">{t('chooseEmployee')}</option>
          {value && !items.some(item => item.id === value) && (
            <option value={value}>{selectedName || selectedLabel || value}</option>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={disabled || pending || !cursors.length}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('previousEmployees')}
        </Button>
        <span className="text-xs text-secondary-500">
          {t('employeePage', { page: cursors.length + 1 })}
        </span>
        <Button
          variant="outline"
          disabled={disabled || pending || !!query.error || !query.data?.nextCursor}
          onClick={() => {
            if (query.data?.nextCursor)
              setCursors(previous => [...previous, query.data!.nextCursor!]);
          }}
        >
          {t('nextEmployees')}
        </Button>
      </div>
    </div>
  );
}
