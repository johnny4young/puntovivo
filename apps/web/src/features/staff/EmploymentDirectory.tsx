import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { translateServerError } from '@/lib/translateServerError';
import type { EmploymentAssignment, EmploymentCursor } from './employmentTypes';
import type { useEmploymentFilters } from './useEmploymentFilters';

/** Shared read-only list contract; additional admin content is rendered only by its owner. */
interface EmploymentDirectoryProps<T extends EmploymentAssignment> {
  filters: ReturnType<typeof useEmploymentFilters>;
  items: T[];
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  nextCursor: EmploymentCursor | null;
  refetch: () => unknown;
  renderExtra?: (item: T) => ReactNode;
  children?: ReactNode;
}

export function EmploymentDirectory<T extends EmploymentAssignment>({
  filters,
  items,
  isPending,
  isFetching,
  error,
  nextCursor,
  refetch,
  renderExtra,
  children,
}: EmploymentDirectoryProps<T>) {
  const { t } = useTranslation(['workforce', 'errors']);
  const failure = error ?? filters.sites.error;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface-1 p-4">
        <label className="block">
          <span className="label">{t('site')}</span>
          <select
            className="input mt-1"
            value={filters.siteId}
            onChange={event => {
              filters.setSiteId(event.target.value);
              filters.setCursors([]);
            }}
          >
            <option value="">{t('allSites')}</option>
            {filters.sites.data?.items.map(site => (
              <option key={site.id} value={site.id}>
                {site.isActive ? site.name : t('archivedSite', { site: site.name })}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('onDate')}</span>
          <input
            className="input mt-1"
            type="date"
            value={filters.onDate}
            onChange={event => {
              filters.setOnDate(event.target.value);
              filters.setCursors([]);
            }}
          />
        </label>
        {children}
        <Button
          variant="outline"
          disabled={isFetching}
          onClick={() => {
            void refetch();
            void filters.sites.refetch();
          }}
        >
          {t('refresh')}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-danger-700">
          {translateServerError(failure, t, t('loadError'))}
        </p>
      )}
      {isPending && <p role="status">{t('loading')}</p>}
      {!isPending && !failure && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-8 text-secondary-600">
          {t('empty')}
        </p>
      )}
      {!failure && (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map(item => (
            <li
              key={item.id}
              className="space-y-3 rounded-xl border border-line bg-surface-1 p-4"
              data-testid={`employment-${item.id}`}
            >
              <div>
                <h3 className="break-words text-lg font-semibold">{item.userName}</h3>
                <p className="break-words text-sm">{item.position}</p>
              </div>
              <p className="text-sm">
                {item.siteActive ? item.siteName : t('archivedSite', { site: item.siteName })}
                {!item.userActive && <span> · {t('inactiveEmployee')}</span>}
              </p>
              <p className="text-sm">
                {t('period', {
                  from: item.effectiveFrom,
                  until: item.effectiveUntil ?? t('openEnded'),
                })}
              </p>
              <p className="text-xs text-secondary-500">
                {t('timezone', { timeZone: item.timeZone })} ·{' '}
                {t('version', { version: item.version })}
              </p>
              {renderExtra?.(item)}
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('pages')}>
        <Button
          variant="outline"
          disabled={!filters.cursors.length || isFetching}
          onClick={() => filters.setCursors(previous => previous.slice(0, -1))}
        >
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!nextCursor || !!failure || isFetching}
          onClick={() => {
            if (nextCursor) filters.setCursors(previous => [...previous, nextCursor]);
          }}
        >
          {t('next')}
        </Button>
      </nav>
    </div>
  );
}
