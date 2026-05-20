/**
 * ENG-089 — V5 "Cuenta corriente" panel for a single customer.
 *
 * Shows the running balance + last-N ledger entries with three CTAs:
 *  - `Recibir abono` (manager+): opens the abono modal, fires
 *    `customerLedger.addPayment`.
 *  - `Estado cuenta` (manager+): exports the visible rows as CSV via
 *    the shared `exportToCSV` helper. Filename includes the localized
 *    statement label, customer name, optional tax ID, and local date.
 *  - `Cargar a cuenta` (admin only): opens the same modal in the
 *    adjustment variant. Manager sees the button disabled with a
 *    tooltip explaining the gate. Cashier never reaches this surface
 *    (manager+ row action gating on the parent).
 *
 * The ledger panel never writes a denormalized balance; `getBalance`
 * is a separate query that the server resolves via `SUM(amount)`. The
 * two queries share invalidation so a successful abono / ajuste
 * refreshes both in one click.
 *
 * Frecuente badge is documented as deferred to ENG-089b — a
 * placeholder slot stays for future wiring.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import { onErrorToast } from '@/lib/mutationHelpers';
import {
  buildSemanticFilename,
  exportToCSV,
  type ExportColumn,
} from '@/services/export/exportService';
import {
  CustomerLedgerAbonoModal,
  type CustomerLedgerAbonoMode,
  type CustomerLedgerAbonoValues,
} from '@/features/customers/CustomerLedgerAbonoModal';
import type { Customer } from '@/types';

interface CustomerLedgerModalProps {
  isOpen: boolean;
  customer: Customer | null;
  onClose: () => void;
}

type LedgerEntryRow = {
  id: string;
  occurredAt: string;
  kind: 'sale' | 'payment' | 'adjustment';
  amount: number;
  note: string | null;
  referenceSaleId: string | null;
};

function formatOccurredAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatFilenameDate(date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * ENG-103 — Customer ledger statement filename. The semantic helper
 * resolves the canonical `ledger-estadocuenta-<customer>-<date>` shape
 * (plus the customer tax id when available) and re-uses the
 * accent / casing normalisation baked into `generateFilename`.
 * `exportToCSV` is invoked with `includeTimestamp: false` so the
 * timestamp inside the filename matches the date we already encode.
 */
function buildStatementFilename(customer: Customer): string {
  return buildSemanticFilename(
    {
      kind: 'ledger',
      customer: customer.name,
      taxId: customer.taxId ?? null,
      date: formatFilenameDate(),
    },
    'csv'
  );
}

export function CustomerLedgerModal({ isOpen, customer, onClose }: CustomerLedgerModalProps) {
  const { t } = useTranslation('customers');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();

  const [abonoMode, setAbonoMode] = useState<CustomerLedgerAbonoMode | null>(null);

  const customerId = customer?.id ?? '';
  const isAdmin = user?.role === 'admin';

  // Both queries fire only when the modal is open with a real
  // customer so background polling does not run while the operator
  // is on the customers list.
  const ledgerQuery = trpc.customerLedger.list.useQuery(
    { customerId, limit: 50 },
    { enabled: isOpen && !!customerId }
  );
  const balanceQuery = trpc.customerLedger.getBalance.useQuery(
    { customerId },
    { enabled: isOpen && !!customerId }
  );

  const refreshLedger = async () => {
    if (!customerId) return;
    await Promise.all([
      utils.customerLedger.list.invalidate({ customerId, limit: 50 }),
      utils.customerLedger.getBalance.invalidate({ customerId }),
    ]);
  };

  const addPayment = trpc.customerLedger.addPayment.useMutation({
    onSuccess: async () => {
      await refreshLedger();
      setAbonoMode(null);
      toast.success({ title: t('ledger.abonoModal.success') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'ledger.abonoModal.error' }),
  });
  const addAdjustment = trpc.customerLedger.addAdjustment.useMutation({
    onSuccess: async () => {
      await refreshLedger();
      setAbonoMode(null);
      toast.success({ title: t('ledger.adjustmentModal.success') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'ledger.adjustmentModal.error' }),
  });

  const handleAbonoSubmit = async (values: CustomerLedgerAbonoValues) => {
    if (!customerId) return;
    if (abonoMode === 'payment') {
      await addPayment.mutateAsync({
        customerId,
        amount: values.amount,
        note: values.note || undefined,
      });
    } else if (abonoMode === 'adjustment') {
      await addAdjustment.mutateAsync({
        customerId,
        amount: values.amount,
        note: values.note,
      });
    }
  };

  const balance = balanceQuery.data?.balance ?? 0;
  const creditLimit = customer?.creditLimit ?? 0;
  // ENG-090 will project the in-flight cart total on top of the
  // current balance; today the projection equals the balance.
  const projectedBalance = balance;
  const cupoExceeded = creditLimit > 0 && projectedBalance > creditLimit;
  const ledgerRows: LedgerEntryRow[] = (ledgerQuery.data ?? []) as LedgerEntryRow[];

  const handleEstadoCuentaExport = () => {
    if (!customer) return;
    const columns: ExportColumn<LedgerEntryRow>[] = [
      { key: 'occurredAt', header: t('ledger.modal.column.occurredAt') },
      {
        key: 'kind',
        header: t('ledger.modal.column.kind'),
        formatter: value => t(`ledger.modal.kind.${String(value)}`),
      },
      {
        key: 'amount',
        header: t('ledger.modal.column.amount'),
        formatter: value => formatCurrency(Number(value)),
      },
      { key: 'note', header: t('ledger.modal.column.note') },
    ];
    // `buildStatementFilename` returns the full filename WITH extension
    // (e.g. `ledger-estadocuenta-juan-perez-2026-05-20.csv`). Strip the
    // trailing `.csv` so `exportToCSV` (which always appends the
    // extension itself) does not produce `...csv.csv`.
    const filename = buildStatementFilename(customer).replace(/\.csv$/, '');
    exportToCSV(ledgerRows, columns, filename, { includeTimestamp: false });
    toast.success({ title: t('ledger.estadoCuenta.successToast') });
  };

  const isMutating = addPayment.isPending || addAdjustment.isPending;
  const mutationError =
    addPayment.error?.message ?? addAdjustment.error?.message ?? null;

  if (!customer) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} size="xl" title={t('ledger.modal.title')}>
        <p className="text-sm text-secondary-500">{t('ledger.modal.empty')}</p>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        closeOnBackdrop={!abonoMode}
        closeOnEsc={!abonoMode}
        size="xl"
        title={t('ledger.modal.title')}
        footer={
          <ModalButton onClick={onClose}>{t('ledger.actions.close')}</ModalButton>
        }
      >
        <div className="space-y-5">
          {/* Customer card */}
          <header className="rounded-lg border border-line bg-secondary-50 p-4">
            <div className="flex items-start gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-lg font-medium text-primary-700"
                aria-hidden
              >
                {customer.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <h2 className="font-display text-lg font-medium text-secondary-900">
                  {customer.name}
                </h2>
                <p className="text-xs text-secondary-500">
                  {customer.taxId || t('ledger.modal.noTaxId')}
                </p>
                {/* ENG-089b — Frecuente badge slot (deferred). */}
              </div>
            </div>
          </header>

          {/* 3-cell metric strip */}
          <div className="grid grid-cols-3 gap-3" data-testid="ledger-metric-strip">
            <MetricCell
              label={t('ledger.modal.balanceLabel')}
              value={formatCurrency(balance)}
              tone={balance > 0 ? 'danger' : 'default'}
              testId="ledger-metric-balance"
            />
            <MetricCell
              label={t('ledger.modal.cupoLabel')}
              value={
                creditLimit > 0 ? formatCurrency(creditLimit) : t('ledger.modal.cupoUnset')
              }
              testId="ledger-metric-cupo"
            />
            <MetricCell
              label={t('ledger.modal.projectedLabel')}
              value={formatCurrency(projectedBalance)}
              tone={cupoExceeded ? 'warning' : 'default'}
              testId="ledger-metric-projected"
            />
          </div>

          {/* CTA row */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              data-testid="ledger-cta-abono"
              onClick={() => setAbonoMode('payment')}
            >
              {t('ledger.cta.abono')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              data-testid="ledger-cta-estado-cuenta"
              disabled={ledgerRows.length === 0}
              onClick={handleEstadoCuentaExport}
            >
              {t('ledger.cta.estadoCuenta')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              data-testid="ledger-cta-cargar-cuenta"
              disabled={!isAdmin}
              title={isAdmin ? undefined : t('ledger.adminOnly')}
              onClick={() => setAbonoMode('adjustment')}
            >
              {t('ledger.cta.cargarCuenta')}
            </button>
          </div>

          {/* Ledger table */}
          <div className="overflow-x-auto rounded border border-line">
            <table className="min-w-full text-sm" data-testid="ledger-rows-table">
              <thead className="bg-secondary-50 text-xs uppercase text-secondary-600">
                <tr>
                  <th className="px-3 py-2 text-left">
                    {t('ledger.modal.column.occurredAt')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('ledger.modal.column.kind')}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {t('ledger.modal.column.amount')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('ledger.modal.column.note')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledgerQuery.isLoading && (
                  <tr>
                    <td
                      className="px-3 py-3 text-secondary-500"
                      colSpan={4}
                      data-testid="ledger-loading"
                    >
                      {t('ledger.modal.loading')}
                    </td>
                  </tr>
                )}
                {!ledgerQuery.isLoading && ledgerRows.length === 0 && (
                  <tr>
                    <td
                      className="px-3 py-3 text-secondary-500"
                      colSpan={4}
                      data-testid="ledger-empty"
                    >
                      {t('ledger.modal.empty')}
                    </td>
                  </tr>
                )}
                {ledgerRows.map(row => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="px-3 py-2 text-secondary-700">
                      {formatOccurredAt(row.occurredAt)}
                    </td>
                    <td className="px-3 py-2 text-secondary-700">
                      {t(`ledger.modal.kind.${row.kind}`)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${row.amount < 0 ? 'text-success-700' : 'text-secondary-900'}`}
                    >
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs text-secondary-500">
                      {row.note || row.referenceSaleId || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {abonoMode && (
        <CustomerLedgerAbonoModal
          mode={abonoMode}
          isOpen
          isSaving={isMutating}
          error={mutationError}
          onClose={() => setAbonoMode(null)}
          onSubmit={handleAbonoSubmit}
        />
      )}
    </>
  );
}

interface MetricCellProps {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'warning';
  testId?: string;
}

function MetricCell({ label, value, tone = 'default', testId }: MetricCellProps) {
  const toneClass =
    tone === 'danger'
      ? 'border-danger-300 bg-danger-50 text-danger-700'
      : tone === 'warning'
        ? 'border-warning-300 bg-warning-50 text-warning-700'
        : 'border-line bg-white text-secondary-900';
  return (
    <div className={`rounded border p-3 ${toneClass}`} data-testid={testId}>
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
    </div>
  );
}
