import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/feedback/ToastProvider';
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
  'inventory.count.create',
  'inventory.count.save',
  'inventory.count.submit',
  'inventory.count.approve',
  'inventory.count.reject',
  'inventory.transformation.recipe.create',
  'inventory.transformation.recipe.update',
  'inventory.transformation.execute',
  'inventory.transformation.void',
  'purchase.receive',
  'purchase.return',
  'order.create',
  'order.submit',
  'order.void',
  'provider_payable.invoice.create',
  'provider_payable.opening.create',
  'provider_payable.payment.create',
  'provider_payable.credit.create',
  'transfer.create',
  'transfer.receive',
  'ai.anomaly.detected',
  'ai.anomaly.silenced',
  'ai.invoice_ocr.extract',
  'ai.invoice_ocr.confirm',
  'ai.copilot.query',
  'ai.copilot.response_mode.updated',
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
  // staff credential lifecycle and shared-terminal identity handoff.
  'user.pin.update',
  'auth.staff_switch',
  // self-service attendance lifecycle.
  'employee_shift.clock_in',
  'employee_shift.clock_out',
  'employee_shift.correct',
  // explicit employee break boundaries.
  'employee_shift_break.start',
  'employee_shift_break.end',
  // manager-authored schedule lifecycle.
  'scheduled_shift.create',
  'scheduled_shift.update',
  'scheduled_shift.cancel',
  'employment_contract.changed',
  'schedule_plan.changed',
  'shift_swap.changed',
  'attendance_reconciliation.changed',
  // dual-control request and decision lifecycle.
  'manager_approval.request',
  'manager_approval.approve',
  'manager_approval.reject',
  'manager_approval.cancel',
  'manager_approval.consume',
  'loss_prevention.settings.updated',
  'loss_prevention.triggered',
  'loss_prevention.alert.acknowledged',
  'cash_drawer.open',
  'quotation.delete',
  'quotation.convert',
  'external_order.connector',
  'external_order.update',
  'reservation.create',
  'reservation.update',
  'delivery.create',
  'delivery.transition',
  'kds.order.ready',
  'kds.order.recalled',
  'kds.order.preparing',
  'kds.order.resent',
  'kds.order.relocated',
  'kds.order.voided',
  'kds.station.saved',
  'kds.routing.saved',
  'kds.routing.removed',
  'customer.credit_limit.update',
  'customer.price_tier.update',
  'customer.personal_data.export',
  'customer.personal_data.delete',
  'customer.personal_data.anonymize',
  'data_retention.policy.updated',
  'data_retention.sweep.run',
  // expiry-radar discount suggestions.
  'inventory.lot.discount_suggested',
  'inventory.lot.discount_suggestion_dismissed',
  'inventory.lot.discount_promotion_activated',
  'promotion.create',
  'promotion.update',
  'promotion.status_changed',
  'pharmacy.authorization.create',
  'pharmacy.authorization.revoke',
  'pharmacy.product.profile.update',
  'pharmacy.evidence.record',
  'pharmacy.evidence.approve',
  'pharmacy.evidence.revoke',
  'pharmacy.evidence.dispense',
  'pharmacy.recall.create',
  'pharmacy.recall.close',
  'pharmacy.lot.transition',
  'pharmacy.lot.destroy',
  // admin recovery-readiness evidence.
  'pricing.tax_mode.updated',
  'backup.restore_drill',
  'backup.encryption_key_reveal',
  'security.db_key_rotation',
  // -123b — launch import summaries.
  'data_import.products',
  'data_import.customers',
  'data_import.providers',
  'data_import.customer_balances',
  'data_import.opening_cash',
  'data_import.fiscal_profile',
  // irreversible manager/admin day-close attestation.
  'day_close.sign_off',
  // outbound integration custody and recovery.
  'webhook_subscription.create',
  'webhook_subscription.disable',
  'webhook_subscription.revoke',
  'webhook_delivery.retry',
];

const RESOURCE_TYPE_OPTIONS: readonly AuditLogResourceType[] = [
  'sale',
  'sale_return',
  'cash_session',
  'cash_movement',
  'product',
  'inventory_transformation_recipe',
  'inventory_transformation',
  'purchase',
  'order',
  'provider_payable',
  'transfer_order',
  'user',
  'employee_shift',
  'employee_shift_break',
  'scheduled_shift',
  'employment_contract',
  'schedule_plan',
  'shift_swap',
  'attendance_reconciliation',
  'manager_approval',
  'loss_prevention_rule',
  'loss_prevention_alert',
  'site',
  'cashier',
  'quotation',
  'ai_feature',
  'kds_order',
  'external_order',
  'external_order_connector',
  'restaurant_reservation',
  'delivery_order',
  'kds_configuration',
  'customer',
  'tenant',
  // expiry-radar discount suggestions.
  'price_suggestion',
  'promotion',
  'pharmacy_authorization',
  'pharmacy_product_profile',
  'pharmacy_prescription_evidence',
  'pharmacy_recall',
  'inventory_lot',
  // scheduler-owned encrypted snapshots.
  'backup_snapshot',
  'backup_key',
  // one auditable launch import run.
  'data_import',
  // immutable comprehensive day-close evidence.
  'day_close_signoff',
  // outbound integration configuration and delivery recovery.
  'webhook_subscription',
  'webhook_outbox',
];

/**
 * admin-only audit trail viewer.
 *
 * Composition-only: the filter bar drives the trpc query input, and the
 * table renders the result + the export toolbar. Keeping filter state in
 * this page (rather than the table) lets us expose the same query payload
 * to future features like saved views or scheduled exports.
 */
export function AuditLogsPage() {
  const { t } = useTranslation('auditLogs');
  const toast = useToast();

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

  // on-demand integrity check of the tenant hash chain. Kept
  // as a manual action (not a page-load query): the walk touches every
  // audit row, and the operator wants a deliberate, timestamped answer.
  const verifyChainQuery = trpc.auditLogs.verifyChain.useQuery(undefined, { enabled: false });
  const handleVerifyChain = async () => {
    const result = await verifyChainQuery.refetch();
    // A failed refetch keeps the PREVIOUS successful payload in
    // result.data — branch on the error first or a stale intact
    // verdict would be reported as fresh.
    if (result.error || !result.data) {
      toast.error({ title: t('chain.errorTitle') });
      return;
    }
    const data = result.data;
    if (data.valid) {
      // Distinguish an HMAC-authenticated head from external monotonic
      // freshness. Both are stronger than an unkeyed chain, but only the
      // latter detects a database rewind to an older valid head + MAC.
      const guarantee = data.freshnessAnchored
        ? 'FreshnessAnchored'
        : data.anchored
          ? 'Anchored'
          : '';
      toast.success({
        title: t(`chain.valid${guarantee}Title`),
        description: t(`chain.valid${guarantee}Description`, {
          checked: data.checkedCount,
          legacy: data.unchainedCount,
        }),
      });
    } else {
      toast.error({
        title: t('chain.brokenTitle'),
        description: t('chain.brokenDescription', { reason: data.reason ?? 'unknown' }),
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-secondary-900">{t('page.title')}</h1>
        <button
          type="button"
          className="btn-outline"
          data-testid="audit-verify-chain"
          disabled={verifyChainQuery.isFetching}
          onClick={() => void handleVerifyChain()}
        >
          {verifyChainQuery.isFetching ? t('chain.verifying') : t('chain.verify')}
        </button>
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
