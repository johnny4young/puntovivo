import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import type { AuditLogAction, AuditLogResourceType } from '@/types';
import { AuditLogsTable } from './AuditLogsTable';

// Order matches the operational frequency cashiers think in: stock and
// register events first, then sale-level reversals, then back-office
// quotations / transfers. Translations are keyed by the action literal so
// adding an entry here only needs the matching i18n key.
const ACTION_OPTIONS: readonly AuditLogAction[] = [
  'cash_session.close',
  'inventory.adjust_stock',
  'sale.void',
  'sale.return',
  'sale.price_override',
  'purchase.void',
  'transfer.void',
  'user.create',
  'user.update',
  'quotation.delete',
  'quotation.convert',
];

const RESOURCE_TYPE_OPTIONS: readonly AuditLogResourceType[] = [
  'sale',
  'cash_session',
  'product',
  'purchase',
  'transfer_order',
  'user',
  'quotation',
];

/**
 * Phase 8 / Tier-2 #8 — admin-only audit trail viewer.
 *
 * Composition-only: the filter bar drives the trpc query input, and the
 * table renders the result + the export toolbar. Keeping filter state in
 * this page (rather than the table) lets us expose the same query payload
 * to future features like saved views or scheduled exports.
 */
export function AuditLogsPage() {
  const { t } = useTranslation('auditLogs');

  const [action, setAction] = useState<AuditLogAction | ''>('');
  const [resourceType, setResourceType] = useState<AuditLogResourceType | ''>('');
  const [createdAfter, setCreatedAfter] = useState<string>('');
  const [createdBefore, setCreatedBefore] = useState<string>('');

  const queryInput = useMemo(() => {
    const payload: Record<string, unknown> = {};
    if (action) payload.action = action;
    if (resourceType) payload.resourceType = resourceType;
    // <input type="date"> returns `YYYY-MM-DD`; anchor to the cashier's
    // local timezone with end-of-day for the upper bound so a half-open
    // range never trims events from the selected day.
    if (createdAfter) {
      payload.createdAfter = new Date(`${createdAfter}T00:00:00`).toISOString();
    }
    if (createdBefore) {
      payload.createdBefore = new Date(`${createdBefore}T23:59:59`).toISOString();
    }
    return Object.keys(payload).length > 0 ? payload : undefined;
  }, [action, resourceType, createdAfter, createdBefore]);

  const listQuery = trpc.auditLogs.list.useQuery(queryInput, {
    staleTime: 30_000,
  });

  const items = listQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">{t('page.kicker')}</p>
          <h1 className="text-2xl font-semibold text-secondary-900">
            {t('page.title')}
          </h1>
          <p className="text-sm text-secondary-600">{t('page.description')}</p>
        </div>
      </div>

      <div className="card p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block">
            <span className="label">{t('filters.action')}</span>
            <select
              className="input mt-1"
              value={action}
              onChange={event => setAction(event.target.value as AuditLogAction | '')}
            >
              <option value="">{t('filters.all')}</option>
              {ACTION_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {t(`actions.${opt}`, { defaultValue: opt })}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('filters.resourceType')}</span>
            <select
              className="input mt-1"
              value={resourceType}
              onChange={event =>
                setResourceType(event.target.value as AuditLogResourceType | '')
              }
            >
              <option value="">{t('filters.all')}</option>
              {RESOURCE_TYPE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {t(`resourceTypes.${opt}`, { defaultValue: opt })}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('filters.createdAfter')}</span>
            <input
              type="date"
              className="input mt-1"
              value={createdAfter}
              onChange={event => setCreatedAfter(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">{t('filters.createdBefore')}</span>
            <input
              type="date"
              className="input mt-1"
              value={createdBefore}
              onChange={event => setCreatedBefore(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('history.title')}
          </h2>
          <p className="text-sm text-secondary-500">{t('history.description')}</p>
        </div>
        <AuditLogsTable
          items={items}
          isLoading={listQuery.isLoading}
          error={listQuery.error}
          onRetry={() => void listQuery.refetch()}
        />
      </div>
    </div>
  );
}
