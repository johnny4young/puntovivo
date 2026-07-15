import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import type { AuditLogAction, AuditLogResourceType } from '@/types';
import { AuditLogsTable } from './AuditLogsTable';
import { SensitiveAuditReview, type AuditReviewCategory } from './SensitiveAuditReview';

// Order matches the operational frequency cashiers think in: stock and
// register events first, then sale-level reversals, then back-office
// quotations / transfers. Translations are keyed by the action literal so
// adding an entry here only needs the matching i18n key.
const ACTION_OPTIONS: readonly AuditLogAction[] = [
  'cash_session.open',
  'cash_session.close',
  'cash_session.movement',
  'inventory.adjust_stock',
  'ai.anomaly.detected',
  'ai.anomaly.silenced',
  'ai.invoice_ocr.extract',
  'ai.invoice_ocr.confirm',
  'ai.copilot.query',
  'ai.semantic_search.regenerate_embeddings',
  'sale.void',
  'sale.return',
  'sale.price_override',
  'sale.park',
  'sale.resume',
  'sale.changeTable',
  'sale.splitDraft',
  'sale.reprint',
  'sale.complete',
  'sale.credit_override',
  'purchase.void',
  'transfer.void',
  'user.create',
  'user.update',
  // ENG-106a — staff credential lifecycle and shared-terminal identity handoff.
  'user.pin.update',
  'auth.staff_switch',
  // ENG-106b — self-service attendance lifecycle.
  'employee_shift.clock_in',
  'employee_shift.clock_out',
  // ENG-140a — manager-authored schedule lifecycle.
  'scheduled_shift.create',
  'scheduled_shift.update',
  'scheduled_shift.cancel',
  // ENG-106c — dual-control request and decision lifecycle.
  'manager_approval.request',
  'manager_approval.approve',
  'manager_approval.reject',
  'manager_approval.cancel',
  'manager_approval.consume',
  'cash_drawer.open',
  'quotation.delete',
  'quotation.convert',
  'kds.order.ready',
  'kds.order.recalled',
  'customer.credit_limit.update',
  'customer.personal_data.export',
  'customer.personal_data.delete',
  'customer.personal_data.anonymize',
  'data_retention.policy.updated',
  'data_retention.sweep.run',
  // ENG-199 — expiry-radar discount suggestions.
  'inventory.lot.discount_suggested',
  'inventory.lot.discount_suggestion_dismissed',
  // ENG-136b — admin recovery-readiness evidence.
  'backup.restore_drill',
  // ENG-123a/ENG-123b — launch import summaries.
  'data_import.products',
  'data_import.customers',
  'data_import.providers',
  'data_import.customer_balances',
  'data_import.opening_cash',
  'data_import.fiscal_profile',
  // ENG-141b — irreversible manager/admin day-close attestation.
  'day_close.sign_off',
];

const RESOURCE_TYPE_OPTIONS: readonly AuditLogResourceType[] = [
  'sale',
  'cash_session',
  'cash_movement',
  'product',
  'purchase',
  'transfer_order',
  'user',
  'employee_shift',
  'scheduled_shift',
  'manager_approval',
  'site',
  'cashier',
  'quotation',
  'ai_feature',
  'kds_order',
  'customer',
  'tenant',
  // ENG-199 — expiry-radar discount suggestions.
  'price_suggestion',
  // ENG-136b — scheduler-owned encrypted snapshots.
  'backup_snapshot',
  // ENG-123a — one auditable launch import run.
  'data_import',
  // ENG-141b — immutable comprehensive day-close evidence.
  'day_close_signoff',
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
  const [sensitiveCategory, setSensitiveCategory] = useState<AuditReviewCategory | null>(null);

  const dateRangeInput = useMemo(() => {
    const payload: Record<string, unknown> = {};
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
  }, [createdAfter, createdBefore]);

  const queryInput = useMemo(() => {
    const payload: Record<string, unknown> = { ...dateRangeInput };
    if (action) payload.action = action;
    if (resourceType) payload.resourceType = resourceType;
    if (sensitiveCategory) payload.sensitiveCategory = sensitiveCategory;
    return Object.keys(payload).length > 0 ? payload : undefined;
  }, [action, resourceType, sensitiveCategory, dateRangeInput]);

  const listQuery = trpc.auditLogs.list.useQuery(queryInput, {
    staleTime: 30_000,
  });
  const summaryQuery = trpc.auditLogs.sensitiveSummary.useQuery(dateRangeInput, {
    staleTime: 30_000,
  });

  const items = listQuery.data?.items ?? [];
  const summary = summaryQuery.data ?? { total: 0, categories: [] };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-secondary-900">{t('page.title')}</h1>
      </div>

      <SensitiveAuditReview
        total={summary.total}
        categories={summary.categories}
        selectedCategory={sensitiveCategory}
        isLoading={summaryQuery.isLoading}
        error={summaryQuery.error}
        onSelectCategory={category => {
          setSensitiveCategory(category);
          if (category) setAction('');
        }}
        onRetry={() => void summaryQuery.refetch()}
      />

      <div className="card p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block">
            <span className="label">{t('filters.action')}</span>
            <select
              className="input mt-1"
              value={action}
              onChange={event => {
                const nextAction = event.target.value as AuditLogAction | '';
                setAction(nextAction);
                if (nextAction) setSensitiveCategory(null);
              }}
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
              onChange={event => setResourceType(event.target.value as AuditLogResourceType | '')}
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
          <h2 className="text-lg font-semibold text-secondary-900">{t('history.title')}</h2>
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
