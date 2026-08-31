import { useMemo, useState, type FormEvent } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { CreditCard, FilePlus2, Landmark, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { calendarDayAt, formatCalendarDay, formatCurrency } from '@/lib/utils';
import type { Provider } from '@/types';
import { allocateOldestInvoices, allocationTotal } from './providerPayables';

type PayableOverview = inferRouterOutputs<AppRouter>['providerPayables']['overview'];
type PayableAction = 'invoice' | 'opening' | 'payment' | 'credit';

interface ProviderPayablesModalProps {
  isOpen: boolean;
  provider: Provider;
  onClose: () => void;
}

interface FormState {
  purchaseId: string;
  documentNumber: string;
  issuedAt: string;
  dueAt: string;
  amount: string;
  method: 'cash' | 'card' | 'transfer' | 'other';
  reference: string;
  notes: string;
}

function initialForm(today: string): FormState {
  return {
    purchaseId: '',
    documentNumber: '',
    issuedAt: today,
    dueAt: today,
    amount: '',
    method: 'transfer',
    reference: '',
    notes: '',
  };
}

function amountValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const AGING_KEYS = ['current', 'days1To30', 'days31To60', 'days61To90', 'daysOver90'] as const;

export function ProviderPayablesModal({ isOpen, provider, onClose }: ProviderPayablesModalProps) {
  const { t } = useTranslation(['providerPayables', 'quotationPayablesErrors', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const locale = useResolvedLocale();
  const currentBusinessDay = () => calendarDayAt(new Date(), locale.timezone);
  const [action, setAction] = useState<PayableAction | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(currentBusinessDay()));

  const overviewQuery = trpc.providerPayables.overview.useQuery(
    { providerId: provider.id },
    { enabled: isOpen }
  );
  const overview = overviewQuery.data as PayableOverview | undefined;

  const finishAction = async (kind: PayableAction) => {
    await utils.providerPayables.overview.invalidate({ providerId: provider.id });
    setAction(null);
    setForm(initialForm(currentBusinessDay()));
    toast.success({ title: t(`providerPayables:toast.${kind}`) });
  };
  const createInvoice = useCriticalMutation('providerPayables.createInvoice', {
    onSuccess: () => finishAction('invoice'),
    onError: onErrorToast(toast, t, {
      titleKey: 'providerPayables:toast.error',
    }),
  });
  const createOpening = useCriticalMutation('providerPayables.createOpeningBalance', {
    onSuccess: () => finishAction('opening'),
    onError: onErrorToast(toast, t, {
      titleKey: 'providerPayables:toast.error',
    }),
  });
  const recordPayment = useCriticalMutation('providerPayables.recordPayment', {
    onSuccess: () => finishAction('payment'),
    onError: onErrorToast(toast, t, {
      titleKey: 'providerPayables:toast.error',
    }),
  });
  const recordCredit = useCriticalMutation('providerPayables.recordCredit', {
    onSuccess: () => finishAction('credit'),
    onError: onErrorToast(toast, t, {
      titleKey: 'providerPayables:toast.error',
    }),
  });
  const isPending =
    createInvoice.isPending ||
    createOpening.isPending ||
    recordPayment.isPending ||
    recordCredit.isPending;

  const amount = amountValue(form.amount);
  const proposedAllocations = useMemo(
    () => allocateOldestInvoices(overview?.openInvoices ?? [], amount),
    [amount, overview?.openInvoices]
  );
  const allocated = allocationTotal(proposedAllocations);
  const allocationComplete = amount > 0 && allocated === amount;
  const datesValid =
    action === 'invoice' || action === 'opening' ? form.dueAt >= form.issuedAt : true;
  const canSubmit =
    !isPending &&
    amount > 0 &&
    form.issuedAt.length > 0 &&
    form.dueAt.length > 0 &&
    datesValid &&
    (action === 'invoice'
      ? form.documentNumber.trim().length > 0
      : action === 'opening'
        ? form.notes.trim().length > 0
        : action === 'payment'
          ? allocationComplete
          : action === 'credit'
            ? allocationComplete &&
              form.documentNumber.trim().length > 0 &&
              form.notes.trim().length > 0
            : false);

  const openAction = (next: PayableAction) => {
    setForm(initialForm(currentBusinessDay()));
    setAction(next);
  };

  const handlePurchaseChange = (purchaseId: string) => {
    const purchase = overview?.availablePurchases.find(candidate => candidate.id === purchaseId);
    setForm(current => ({
      ...current,
      purchaseId,
      amount: purchase ? String(purchase.total) : current.amount,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || !canSubmit) return;

    if (action === 'invoice') {
      createInvoice.mutate({
        providerId: provider.id,
        ...(form.purchaseId ? { purchaseId: form.purchaseId } : {}),
        documentNumber: form.documentNumber.trim(),
        issuedAt: form.issuedAt,
        dueAt: form.dueAt,
        amount,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      return;
    }
    if (action === 'opening') {
      createOpening.mutate({
        providerId: provider.id,
        asOf: form.issuedAt,
        dueAt: form.dueAt,
        amount,
        note: form.notes.trim(),
      });
      return;
    }
    if (action === 'payment') {
      recordPayment.mutate({
        providerId: provider.id,
        amount,
        method: form.method,
        ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
        paidAt: form.issuedAt,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        allocations: proposedAllocations,
      });
      return;
    }
    recordCredit.mutate({
      providerId: provider.id,
      amount,
      documentNumber: form.documentNumber.trim(),
      creditedAt: form.issuedAt,
      reason: form.notes.trim(),
      allocations: proposedAllocations,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('providerPayables:title', { provider: provider.name })}
      size="full"
    >
      {overviewQuery.isLoading && (
        <p className="py-12 text-center text-sm text-secondary-500" role="status">
          {t('providerPayables:loading')}
        </p>
      )}
      {overviewQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700">
          <p>{translateServerError(overviewQuery.error, t, t('providerPayables:error'))}</p>
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => void overviewQuery.refetch()}
          >
            {t('providerPayables:retry')}
          </button>
        </div>
      )}
      {overview && (
        <div className="space-y-6" data-testid="provider-payables-overview">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(['invoices', 'payments', 'credits', 'balance'] as const).map(key => (
              <div key={key} className="card-inset p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
                  {t(`providerPayables:totals.${key}`)}
                </p>
                <p className="mt-1 font-mono text-xl font-semibold text-secondary-950">
                  {formatCurrency(overview.totals[key])}
                </p>
              </div>
            ))}
          </div>

          <section>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-secondary-950">
                  {t('providerPayables:aging.title')}
                </h3>
                <p className="text-sm text-secondary-500">
                  {t('providerPayables:aging.description')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openAction('invoice')}
                >
                  <FilePlus2 className="mr-2 inline h-4 w-4" aria-hidden="true" />
                  {t('providerPayables:actions.invoice')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => openAction('opening')}
                >
                  <Landmark className="mr-2 inline h-4 w-4" aria-hidden="true" />
                  {t('providerPayables:actions.opening')}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={overview.openInvoices.length === 0}
                  onClick={() => openAction('payment')}
                >
                  <CreditCard className="mr-2 inline h-4 w-4" aria-hidden="true" />
                  {t('providerPayables:actions.payment')}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={overview.openInvoices.length === 0}
                  onClick={() => openAction('credit')}
                >
                  <ReceiptText className="mr-2 inline h-4 w-4" aria-hidden="true" />
                  {t('providerPayables:actions.credit')}
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
              {AGING_KEYS.map(key => (
                <div key={key} className="rounded-xl border border-line bg-surface-2 px-3 py-3">
                  <p className="text-xs text-secondary-500">{t(`providerPayables:aging.${key}`)}</p>
                  <p className="mt-1 font-mono font-semibold text-secondary-900">
                    {formatCurrency(overview.aging[key])}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {action && (
            <form
              className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4"
              onSubmit={handleSubmit}
              data-testid="provider-payable-form"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-primary-950">
                  {t(`providerPayables:form.${action}.title`)}
                </h3>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={isPending}
                  onClick={() => setAction(null)}
                >
                  {t('providerPayables:form.cancel')}
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {action === 'invoice' && (
                  <label className="text-sm text-secondary-700">
                    {t('providerPayables:form.purchase')}
                    <select
                      className="input mt-1"
                      value={form.purchaseId}
                      onChange={event => handlePurchaseChange(event.target.value)}
                    >
                      <option value="">{t('providerPayables:form.noPurchase')}</option>
                      {overview.availablePurchases.map(purchase => (
                        <option key={purchase.id} value={purchase.id}>
                          {purchase.purchaseNumber} · {formatCurrency(purchase.total)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {(action === 'invoice' || action === 'credit') && (
                  <label className="text-sm text-secondary-700">
                    {t('providerPayables:form.documentNumber')}
                    <input
                      className="input mt-1"
                      value={form.documentNumber}
                      maxLength={80}
                      required
                      onChange={event =>
                        setForm(current => ({ ...current, documentNumber: event.target.value }))
                      }
                    />
                  </label>
                )}
                <label className="text-sm text-secondary-700">
                  {t(`providerPayables:form.${action}.date`)}
                  <input
                    className="input mt-1"
                    type="date"
                    value={form.issuedAt}
                    required
                    onChange={event =>
                      setForm(current => ({ ...current, issuedAt: event.target.value }))
                    }
                  />
                </label>
                {(action === 'invoice' || action === 'opening') && (
                  <label className="text-sm text-secondary-700">
                    {t('providerPayables:form.dueAt')}
                    <input
                      className="input mt-1"
                      type="date"
                      min={form.issuedAt}
                      value={form.dueAt}
                      required
                      onChange={event =>
                        setForm(current => ({ ...current, dueAt: event.target.value }))
                      }
                    />
                  </label>
                )}
                <label className="text-sm text-secondary-700">
                  {t('providerPayables:form.amount')}
                  <input
                    className="input mt-1"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    required
                    onChange={event =>
                      setForm(current => ({ ...current, amount: event.target.value }))
                    }
                  />
                </label>
                {action === 'payment' && (
                  <label className="text-sm text-secondary-700">
                    {t('providerPayables:form.method')}
                    <select
                      className="input mt-1"
                      value={form.method}
                      onChange={event =>
                        setForm(current => ({
                          ...current,
                          method: event.target.value as FormState['method'],
                        }))
                      }
                    >
                      {(['cash', 'card', 'transfer', 'other'] as const).map(method => (
                        <option key={method} value={method}>
                          {t(`providerPayables:methods.${method}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {action === 'payment' && (
                  <label className="text-sm text-secondary-700">
                    {t('providerPayables:form.reference')}
                    <input
                      className="input mt-1"
                      value={form.reference}
                      maxLength={120}
                      onChange={event =>
                        setForm(current => ({ ...current, reference: event.target.value }))
                      }
                    />
                  </label>
                )}
                <label className="text-sm text-secondary-700 md:col-span-2">
                  {t(
                    action === 'opening'
                      ? 'providerPayables:form.opening.note'
                      : action === 'credit'
                        ? 'providerPayables:form.credit.reason'
                        : 'providerPayables:form.notes'
                  )}
                  <input
                    className="input mt-1"
                    value={form.notes}
                    maxLength={500}
                    required={action === 'opening' || action === 'credit'}
                    onChange={event =>
                      setForm(current => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>
              </div>
              {(action === 'payment' || action === 'credit') && (
                <div className="mt-3 rounded-xl border border-line bg-white p-3 text-sm">
                  <p className="font-medium text-secondary-900">
                    {t('providerPayables:form.allocationTitle')}
                  </p>
                  <p className="mt-1 text-secondary-600">
                    {t('providerPayables:form.allocationSummary', {
                      allocated: formatCurrency(allocated),
                      amount: formatCurrency(amount),
                    })}
                  </p>
                  {!allocationComplete && amount > 0 && (
                    <p className="mt-1 text-danger-700" role="alert">
                      {t('providerPayables:form.allocationInsufficient')}
                    </p>
                  )}
                </div>
              )}
              {!datesValid && (
                <p className="mt-2 text-sm text-danger-700" role="alert">
                  {t('providerPayables:form.dateInvalid')}
                </p>
              )}
              <div className="mt-4 flex justify-end">
                <button type="submit" className="btn-primary" disabled={!canSubmit}>
                  {isPending
                    ? t('providerPayables:form.saving')
                    : t(`providerPayables:form.${action}.submit`)}
                </button>
              </div>
            </form>
          )}

          <section>
            <h3 className="text-lg font-semibold text-secondary-950">
              {t('providerPayables:invoices.title')}
            </h3>
            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="min-w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('providerPayables:invoices.document')}</th>
                    <th className="px-3 py-2">{t('providerPayables:invoices.site')}</th>
                    <th className="px-3 py-2">{t('providerPayables:invoices.due')}</th>
                    <th className="px-3 py-2 text-right">
                      {t('providerPayables:invoices.amount')}
                    </th>
                    <th className="px-3 py-2 text-right">
                      {t('providerPayables:invoices.outstanding')}
                    </th>
                    <th className="px-3 py-2">{t('providerPayables:invoices.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {overview.invoices.map(invoice => (
                    <tr key={invoice.id}>
                      <td className="px-3 py-2 font-mono">{invoice.documentNumber}</td>
                      <td className="px-3 py-2">{invoice.siteName}</td>
                      <td className="px-3 py-2">{formatCalendarDay(invoice.dueAt)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(invoice.amount)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatCurrency(invoice.outstanding)}
                      </td>
                      <td className="px-3 py-2">
                        {t(`providerPayables:status.${invoice.status}`)}
                      </td>
                    </tr>
                  ))}
                  {overview.invoices.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-secondary-500" colSpan={6}>
                        {t('providerPayables:invoices.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-secondary-950">
              {t('providerPayables:statement.title')}
            </h3>
            <p className="text-sm text-secondary-500">
              {t('providerPayables:statement.description')}
            </p>
            <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-line">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('providerPayables:statement.date')}</th>
                    <th className="px-3 py-2">{t('providerPayables:statement.kind')}</th>
                    <th className="px-3 py-2">{t('providerPayables:statement.reference')}</th>
                    <th className="px-3 py-2 text-right">
                      {t('providerPayables:statement.movement')}
                    </th>
                    <th className="px-3 py-2 text-right">
                      {t('providerPayables:statement.balance')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {overview.statement.map(entry => (
                    <tr key={`${entry.kind}:${entry.id}`}>
                      <td className="px-3 py-2">{formatCalendarDay(entry.occurredAt)}</td>
                      <td className="px-3 py-2">{t(`providerPayables:kind.${entry.kind}`)}</td>
                      <td className="px-3 py-2 font-mono">{entry.reference}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(entry.amount)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatCurrency(entry.balanceAfter)}
                      </td>
                    </tr>
                  ))}
                  {overview.statement.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-secondary-500" colSpan={5}>
                        {t('providerPayables:statement.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {overview.availablePurchases.length > 0 && (
            <section className="rounded-xl border border-warning-200 bg-warning-50 p-4">
              <h3 className="font-semibold text-warning-950">
                {t('providerPayables:uninvoiced.title')}
              </h3>
              <p className="mt-1 text-sm text-warning-800">
                {t('providerPayables:uninvoiced.description', {
                  count: overview.availablePurchases.length,
                })}
              </p>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
