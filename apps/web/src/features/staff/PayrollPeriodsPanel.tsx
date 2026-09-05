import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { isEmploymentDate } from './employmentTypes';
import { payrollPeriodDateIssue, type PayrollPeriod } from './payrollTypes';

interface PeriodFormValues {
  frequency: PayrollPeriod['frequency'];
  fromDate: string;
  untilDate: string;
  payDate: string;
  reason: string;
}

/** Effective-dated period directory; no period may span a reviewed policy transition. */
export function PayrollPeriodsPanel({
  onOpenRuns,
}: {
  onOpenRuns: (period: PayrollPeriod) => void;
}) {
  const { t } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<'' | PayrollPeriod['status']>('');
  const [cursors, setCursors] = useState<Array<{ fromDate: string; id: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<PayrollPeriod | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const query = trpc.workforce.payroll.periods.list.useQuery(
    { status: status || undefined, cursor: cursors.at(-1), limit: 20 },
    { gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.payroll.periods.create', { gcTime: 0 });
  const close = useCriticalMutation('workforce.payroll.periods.close', { gcTime: 0 });

  async function closePeriod() {
    if (!closing || closeReason.trim().length < 10 || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await close.mutateAsync({
        id: closing.id,
        expectedVersion: closing.version,
        reason: closeReason.trim(),
      });
      setClosing(null);
      setCloseReason('');
      setCursors([]);
      await utils.workforce.payroll.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('periods.closeError')));
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="payroll-periods-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="payroll-periods-title" className="text-xl font-semibold">
            {t('periods.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-secondary-600">{t('periods.description')}</p>
        </div>
        <Button
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          {t('periods.actions.create')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface-1 p-4">
        <label className="block">
          <span className="label">{t('periods.filters.status')}</span>
          <select
            className="input mt-1"
            value={status}
            onChange={event => {
              setStatus(event.target.value as typeof status);
              setCursors([]);
            }}
          >
            <option value="">{t('periods.filters.all')}</option>
            <option value="open">{t('periods.status.open')}</option>
            <option value="closed">{t('periods.status.closed')}</option>
          </select>
        </label>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('actions.refresh')}
        </Button>
      </div>
      {query.error && (
        <p role="alert" className="text-danger-700">
          {translateServerError(query.error, t, t('periods.loadError'))}
        </p>
      )}
      {query.isPending && <p role="status">{t('actions.loading')}</p>}
      {!query.isPending && !query.error && query.data?.items.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-8 text-secondary-600">
          {t('periods.empty')}
        </p>
      )}
      <ul className="grid gap-4 lg:grid-cols-2">
        {query.data?.items.map(period => (
          <li key={period.id} className="space-y-3 rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t(`periods.frequencies.${period.frequency}`)}</h3>
                <p className="text-sm">
                  {t('periods.range', { from: period.fromDate, until: period.untilDate })}
                </p>
              </div>
              <span className="rounded-full border border-line px-2 py-1 text-xs">
                {t(`periods.status.${period.status}`)}
              </span>
            </div>
            <p className="text-sm">
              {t('periods.payDate', { date: period.payDate })} · {period.currencyCode}
            </p>
            <p className="text-xs text-secondary-500">
              {t('periods.version', { version: period.version })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => onOpenRuns(period)}>
                {t('periods.actions.runs')}
              </Button>
              {period.status === 'open' && (
                <Button
                  variant="outline"
                  disabled={close.isPending}
                  onClick={() => {
                    setError(null);
                    setCloseReason('');
                    setClosing(period);
                  }}
                >
                  {t('periods.actions.close')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <nav className="flex gap-3" aria-label={t('periods.pages')}>
        <Button
          variant="outline"
          disabled={cursors.length === 0 || query.isFetching}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('actions.previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextCursor || query.isFetching || !!query.error}
          onClick={() => {
            if (query.data?.nextCursor)
              setCursors(previous => [...previous, query.data.nextCursor!]);
          }}
        >
          {t('actions.next')}
        </Button>
      </nav>
      {creating && (
        <CreatePayrollPeriodModal
          saving={create.isPending}
          error={error}
          onClose={() => setCreating(false)}
          onSubmit={async values => {
            if (busy.current) return;
            busy.current = true;
            setError(null);
            try {
              await create.mutateAsync({
                countryCode: 'CO',
                currencyCode: 'COP',
                ...values,
                reason: values.reason.trim(),
              });
              setCreating(false);
              setCursors([]);
              await utils.workforce.payroll.periods.invalidate();
              void utils.auditLogs.invalidate();
            } catch (failure) {
              setError(translateServerError(failure, t, t('periods.saveError')));
            } finally {
              busy.current = false;
            }
          }}
        />
      )}
      {closing && (
        <Modal
          isOpen
          title={t('periods.closeTitle')}
          onClose={() => {
            if (!close.isPending) setClosing(null);
          }}
          closeOnBackdrop={!close.isPending}
          closeOnEsc={!close.isPending}
          showCloseButton={!close.isPending}
          footer={
            <>
              <ModalButton disabled={close.isPending} onClick={() => setClosing(null)}>
                {t('actions.cancel')}
              </ModalButton>
              <ModalButton
                disabled={close.isPending || closeReason.trim().length < 10}
                onClick={() => void closePeriod()}
              >
                {t(close.isPending ? 'actions.saving' : 'periods.actions.close')}
              </ModalButton>
            </>
          }
        >
          <p className="text-sm text-secondary-600">{t('periods.closeNotice')}</p>
          <label className="mt-4 block">
            <span className="label">{t('fields.reason')}</span>
            <textarea
              className="input mt-1 min-h-24"
              maxLength={500}
              value={closeReason}
              disabled={close.isPending}
              onChange={event => setCloseReason(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="mt-3 text-danger-700">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

function CreatePayrollPeriodModal({
  saving,
  error,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: PeriodFormValues) => Promise<void>;
}) {
  const { t } = useTranslation('payroll');
  const form = useForm<PeriodFormValues>({
    defaultValues: { frequency: 'monthly', fromDate: '', untilDate: '', payDate: '', reason: '' },
  });
  const submit = form.handleSubmit(values => onSubmit(values));
  return (
    <Modal
      isOpen
      title={t('periods.actions.create')}
      onClose={onClose}
      closeOnBackdrop={!saving}
      closeOnEsc={!saving}
      showCloseButton={!saving}
      footer={
        <>
          <ModalButton disabled={saving} onClick={onClose}>
            {t('actions.cancel')}
          </ModalButton>
          <ModalButton disabled={saving} onClick={() => void submit()}>
            {t(saving ? 'actions.saving' : 'actions.save')}
          </ModalButton>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={event => void submit(event)}>
        <p className="text-sm text-secondary-600 sm:col-span-2">{t('periods.policyNotice')}</p>
        <label className="block">
          <span className="label">{t('periods.fields.frequency')}</span>
          <select className="input mt-1" disabled={saving} {...form.register('frequency')}>
            {(['weekly', 'biweekly', 'semimonthly', 'monthly', 'other'] as const).map(value => (
              <option key={value} value={value}>
                {t(`periods.frequencies.${value}`)}
              </option>
            ))}
          </select>
        </label>
        {(['fromDate', 'untilDate', 'payDate'] as const).map(field => {
          const message = form.formState.errors[field]?.message;
          return (
            <label className="block" key={field}>
              <span className="label">{t(`periods.fields.${field}`)}</span>
              <input
                type="date"
                className="input mt-1"
                disabled={saving}
                aria-invalid={!!message}
                {...form.register(field, {
                  validate: value => {
                    if (!isEmploymentDate(value)) return t('validation.date');
                    const values = form.getValues();
                    const dates = {
                      fromDate: field === 'fromDate' ? value : values.fromDate,
                      untilDate: field === 'untilDate' ? value : values.untilDate,
                      payDate: field === 'payDate' ? value : values.payDate,
                    };
                    if (!Object.values(dates).every(isEmploymentDate)) return true;
                    const issue = payrollPeriodDateIssue(
                      dates.fromDate,
                      dates.untilDate,
                      dates.payDate
                    );
                    if (field === 'untilDate' && (issue === 'window' || issue === 'periodSpan')) {
                      return t(`validation.${issue}`);
                    }
                    if (field === 'payDate' && issue === 'payDate') {
                      return t('validation.payDate');
                    }
                    return true;
                  },
                })}
              />
              {message && <span className="mt-1 block text-xs text-danger-700">{message}</span>}
            </label>
          );
        })}
        <label className="block sm:col-span-2">
          <span className="label">{t('fields.reason')}</span>
          <textarea
            className="input mt-1 min-h-24"
            maxLength={500}
            disabled={saving}
            {...form.register('reason', {
              validate: value => value.trim().length >= 10 || t('validation.reason'),
            })}
          />
          {form.formState.errors.reason?.message && (
            <span className="mt-1 block text-xs text-danger-700">
              {form.formState.errors.reason.message}
            </span>
          )}
        </label>
        {error && (
          <p role="alert" className="text-danger-700 sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
