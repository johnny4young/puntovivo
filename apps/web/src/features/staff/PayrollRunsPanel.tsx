import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { PayrollPeriod, PayrollRun, PayrollSettlementInput } from './payrollTypes';

const PayrollRecalculationForm = lazy(() =>
  import('./PayrollRecalculationForm').then(module => ({
    default: module.PayrollRecalculationForm,
  }))
);

/** Private append-only run review for one half-open payroll period. */
export function PayrollRunsPanel({
  period,
  onBack,
}: {
  period: PayrollPeriod;
  onBack: () => void;
}) {
  const { t } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const utils = trpc.useUtils();
  const [cursors, setCursors] = useState<Array<{ createdAt: string; id: string }>>([]);
  const [selected, setSelected] = useState<PayrollRun | null>(null);
  const [creating, setCreating] = useState(false);
  const [recalculating, setRecalculating] = useState<PayrollRun | null>(null);
  const [transition, setTransition] = useState<{
    run: PayrollRun;
    action: 'review' | 'approve';
  } | null>(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const query = trpc.workforce.payroll.runs.list.useQuery(
    { periodId: period.id, cursor: cursors.at(-1), limit: 20 },
    { gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.payroll.runs.create', { gcTime: 0 });
  const recalculate = useCriticalMutation('workforce.payroll.runs.recalculate', { gcTime: 0 });
  const review = useCriticalMutation('workforce.payroll.runs.review', { gcTime: 0 });
  const approve = useCriticalMutation('workforce.payroll.runs.approve', { gcTime: 0 });
  const saving = create.isPending || recalculate.isPending || review.isPending || approve.isPending;

  async function refresh() {
    setCursors([]);
    await utils.workforce.payroll.runs.invalidate();
    void utils.auditLogs.invalidate();
  }
  async function recalculateRun(
    employees: PayrollSettlementInput[],
    authorityToken: string,
    policyAcknowledged: boolean,
    reason: string
  ) {
    if (!recalculating || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await recalculate.mutateAsync({
        runId: recalculating.id,
        expectedVersion: recalculating.version,
        authorityToken,
        policyAcknowledged,
        employees,
        reason,
      });
      setRecalculating(null);
      setSelected(null);
      await refresh();
    } catch (failure) {
      setError(translateServerError(failure, t, t('runs.saveError')));
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }
  async function advance() {
    if (!transition || transitionReason.trim().length < 10 || busy.current) return;
    busy.current = true;
    setError(null);
    const mutation = transition.action === 'review' ? review : approve;
    try {
      await mutation.mutateAsync({
        runId: transition.run.id,
        expectedVersion: transition.run.version,
        expectedRevision: transition.run.currentRevision,
        reason: transitionReason.trim(),
      });
      setTransition(null);
      setTransitionReason('');
      setSelected(null);
      await refresh();
    } catch (failure) {
      setError(translateServerError(failure, t, t('runs.saveError')));
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="payroll-runs-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="compact" onClick={onBack}>
            {t('runs.back')}
          </Button>
          <h2 id="payroll-runs-title" className="mt-2 text-xl font-semibold">
            {t('runs.title')}
          </h2>
          <p className="mt-1 text-sm text-secondary-600">
            {t('runs.period', {
              from: period.fromDate,
              until: period.untilDate,
              payDate: period.payDate,
            })}
          </p>
        </div>
        {period.status === 'open' && (
          <Button
            onClick={() => {
              setError(null);
              setCreating(true);
            }}
          >
            {t('runs.actions.create')}
          </Button>
        )}
      </div>
      <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 text-sm text-warning-900">
        <p className="font-semibold">{t('runs.prePayrollTitle')}</p>
        <p className="mt-1">{t('runs.prePayrollNotice')}</p>
      </div>
      {query.error && (
        <p role="alert" className="text-danger-700">
          {translateServerError(query.error, t, t('runs.loadError'))}
        </p>
      )}
      {query.isPending && <p role="status">{t('actions.loading')}</p>}
      {!query.isPending && !query.error && query.data?.items.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-8 text-secondary-600">
          {t('runs.empty')}
        </p>
      )}
      <ul className="grid gap-4 lg:grid-cols-2">
        {query.data?.items.map(run => (
          <li key={run.id} className="space-y-3 rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{t(`runs.kind.${run.kind}`)}</h3>
                <p className="text-xs text-secondary-500">{run.id}</p>
              </div>
              <span className="rounded-full border border-line px-2 py-1 text-xs">
                {t(`runs.status.${run.status}`)}
              </span>
            </div>
            <p className="text-sm">
              {t('runs.revision', { revision: run.currentRevision })} ·{' '}
              {t('runs.version', { version: run.version })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setSelected(run)}>
                {t('runs.actions.details')}
              </Button>
              {period.status === 'open' && run.status === 'draft' && (
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setError(null);
                    setRecalculating(run);
                  }}
                >
                  {t('runs.actions.recalculate')}
                </Button>
              )}
              {period.status === 'open' && run.status === 'draft' && run.currentRevision > 0 && (
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setError(null);
                    setTransitionReason('');
                    setTransition({ run, action: 'review' });
                  }}
                >
                  {t('runs.actions.review')}
                </Button>
              )}
              {period.status === 'open' && run.status === 'reviewed' && (
                <Button
                  disabled={saving}
                  onClick={() => {
                    setError(null);
                    setTransitionReason('');
                    setTransition({ run, action: 'approve' });
                  }}
                >
                  {t('runs.actions.approve')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <nav className="flex gap-3" aria-label={t('runs.pages')}>
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
        <CreatePayrollRunModal
          period={period}
          saving={create.isPending}
          error={error}
          onClose={() => setCreating(false)}
          onSubmit={async (kind, originalRunId, reason) => {
            if (busy.current) return;
            busy.current = true;
            setError(null);
            try {
              await create.mutateAsync({ periodId: period.id, kind, originalRunId, reason });
              setCreating(false);
              await refresh();
            } catch (failure) {
              setError(translateServerError(failure, t, t('runs.saveError')));
            } finally {
              busy.current = false;
            }
          }}
        />
      )}
      {recalculating && (
        <Suspense fallback={<p role="status">{t('actions.loading')}</p>}>
          <PayrollRecalculationForm
            key={`${recalculating.id}:${recalculating.version}`}
            run={recalculating}
            saving={recalculate.isPending}
            error={error}
            onClose={() => setRecalculating(null)}
            onSubmit={recalculateRun}
          />
        </Suspense>
      )}
      {transition && (
        <Modal
          isOpen
          title={t(`runs.${transition.action}Title`)}
          onClose={() => {
            if (!saving) setTransition(null);
          }}
          closeOnBackdrop={!saving}
          closeOnEsc={!saving}
          showCloseButton={!saving}
          footer={
            <>
              <ModalButton disabled={saving} onClick={() => setTransition(null)}>
                {t('actions.cancel')}
              </ModalButton>
              <ModalButton
                disabled={saving || transitionReason.trim().length < 10}
                onClick={() => void advance()}
              >
                {t(saving ? 'actions.saving' : `runs.actions.${transition.action}`)}
              </ModalButton>
            </>
          }
        >
          <p className="text-sm text-secondary-600">
            {t(`runs.${transition.action}Notice`, { revision: transition.run.currentRevision })}
          </p>
          <label className="mt-4 block">
            <span className="label">{t('fields.reason')}</span>
            <textarea
              className="input mt-1 min-h-24"
              maxLength={500}
              value={transitionReason}
              disabled={saving}
              onChange={event => setTransitionReason(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="mt-3 text-danger-700">
              {error}
            </p>
          )}
        </Modal>
      )}
      {selected && <PayrollRunDetails run={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function CreatePayrollRunModal({
  period,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  period: PayrollPeriod;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (
    kind: 'regular' | 'adjustment',
    originalRunId: string | null,
    reason: string
  ) => Promise<void>;
}) {
  const { t } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const [kind, setKind] = useState<'regular' | 'adjustment'>('regular');
  const [originalRunId, setOriginalRunId] = useState('');
  const [reason, setReason] = useState('');
  const originals = trpc.workforce.payroll.runs.list.useQuery(
    { status: 'approved', limit: 100 },
    { enabled: kind === 'adjustment', gcTime: 0, staleTime: 0 }
  );
  const valid = reason.trim().length >= 10 && (kind === 'regular' || !!originalRunId);
  return (
    <Modal
      isOpen
      title={t('runs.actions.create')}
      onClose={onClose}
      closeOnBackdrop={!saving}
      closeOnEsc={!saving}
      showCloseButton={!saving}
      footer={
        <>
          <ModalButton disabled={saving} onClick={onClose}>
            {t('actions.cancel')}
          </ModalButton>
          <ModalButton
            disabled={saving || !valid}
            onClick={() =>
              void onSubmit(kind, kind === 'regular' ? null : originalRunId, reason.trim())
            }
          >
            {t(saving ? 'actions.saving' : 'actions.save')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-600">
          {t('runs.createNotice', { from: period.fromDate, until: period.untilDate })}
        </p>
        <label className="block">
          <span className="label">{t('runs.fields.kind')}</span>
          <select
            className="input mt-1"
            value={kind}
            disabled={saving}
            onChange={event => {
              setKind(event.target.value as typeof kind);
              setOriginalRunId('');
            }}
          >
            <option value="regular">{t('runs.kind.regular')}</option>
            <option value="adjustment">{t('runs.kind.adjustment')}</option>
          </select>
        </label>
        {kind === 'adjustment' && (
          <label className="block">
            <span className="label">{t('runs.fields.originalRun')}</span>
            <select
              className="input mt-1"
              value={originalRunId}
              disabled={saving || originals.isFetching || !!originals.error}
              onChange={event => setOriginalRunId(event.target.value)}
            >
              <option value="">{t('runs.fields.chooseOriginal')}</option>
              {originals.data?.items.map(run => (
                <option key={run.id} value={run.id}>
                  {t('runs.originalOption', {
                    from: run.periodFromDate,
                    until: run.periodUntilDate,
                    id: run.id,
                  })}
                </option>
              ))}
            </select>
          </label>
        )}
        {originals.data?.nextCursor && (
          <p role="alert" className="text-warning-700">
            {t('runs.originalsTruncated')}
          </p>
        )}
        {originals.error && (
          <p role="alert" className="text-danger-700">
            {translateServerError(originals.error, t, t('runs.loadError'))}
          </p>
        )}
        <label className="block">
          <span className="label">{t('fields.reason')}</span>
          <textarea
            className="input mt-1 min-h-24"
            maxLength={500}
            value={reason}
            disabled={saving}
            onChange={event => setReason(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-danger-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function PayrollRunDetails({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { t, i18n } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const detail = trpc.workforce.payroll.runs.get.useQuery(
    { runId: run.id },
    { gcTime: 0, staleTime: 0 }
  );
  const [revisionNumber, setRevisionNumber] = useState(run.currentRevision || 1);
  const [cursors, setCursors] = useState<Array<{ userId: string; id: string }>>([]);
  const revision = trpc.workforce.payroll.runs.revision.useQuery(
    { runId: run.id, revision: revisionNumber, cursor: cursors.at(-1), limit: 25 },
    { enabled: run.currentRevision > 0, gcTime: 0, staleTime: 0 }
  );
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  return (
    <Modal
      isOpen
      title={t('runs.detailsTitle')}
      size="xl"
      onClose={onClose}
      footer={<ModalButton onClick={onClose}>{t('actions.close')}</ModalButton>}
    >
      {detail.isPending && <p role="status">{t('actions.loading')}</p>}
      {detail.error && (
        <p role="alert">{translateServerError(detail.error, t, t('runs.loadError'))}</p>
      )}
      {detail.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Summary label={t('runs.fields.kind')} value={t(`runs.kind.${detail.data.run.kind}`)} />
            <Summary
              label={t('runs.fields.status')}
              value={t(`runs.status.${detail.data.run.status}`)}
            />
            <Summary label={t('runs.fields.version')} value={String(detail.data.run.version)} />
            <Summary
              label={t('runs.fields.currentRevision')}
              value={String(detail.data.run.currentRevision)}
            />
          </div>
          {detail.data.revisions.length > 0 && (
            <label className="block max-w-xs">
              <span className="label">{t('runs.fields.revision')}</span>
              <select
                className="input mt-1"
                value={revisionNumber}
                onChange={event => {
                  setRevisionNumber(Number(event.target.value));
                  setCursors([]);
                }}
              >
                {detail.data.revisions.map(row => (
                  <option key={row.id} value={row.revision}>
                    {t('runs.revisionOption', {
                      revision: row.revision,
                      status: t(`runs.calculationStatus.${row.status}`),
                    })}
                  </option>
                ))}
              </select>
            </label>
          )}
          {detail.data.revisionsTruncated && (
            <p role="alert" className="text-warning-700">
              {t('runs.revisionsTruncated')}
            </p>
          )}
          {run.currentRevision === 0 ? (
            <p>{t('runs.noRevision')}</p>
          ) : revision.isPending ? (
            <p role="status">{t('actions.loading')}</p>
          ) : revision.error ? (
            <p role="alert">{translateServerError(revision.error, t, t('runs.loadError'))}</p>
          ) : revision.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Summary
                  label={t('runs.totals.gross')}
                  value={money(
                    revision.data.revision.grossAmount,
                    revision.data.revision.currencyCode
                  )}
                />
                <Summary
                  label={t('runs.totals.deductions')}
                  value={money(
                    revision.data.revision.deductionAmount,
                    revision.data.revision.currencyCode
                  )}
                />
                <Summary
                  label={t('runs.totals.net')}
                  value={money(
                    revision.data.revision.netAmount,
                    revision.data.revision.currencyCode
                  )}
                />
                <Summary
                  label={t('runs.totals.employer')}
                  value={money(
                    revision.data.revision.employerContributionAmount,
                    revision.data.revision.currencyCode
                  )}
                />
              </div>
              {revision.data.revision.blockers.length > 0 && (
                <p role="alert" className="text-warning-700">
                  {t('runs.blockers', {
                    blockers: revision.data.revision.blockers
                      .map(blocker => t(`runs.blockerLabels.${blocker}`))
                      .join('; '),
                  })}
                </p>
              )}
              <ul className="space-y-3">
                {revision.data.employees.map(employee => (
                  <li key={employee.id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold">{employee.userName}</h3>
                      <span className="text-xs">
                        {t(`runs.calculationStatus.${employee.status}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">
                      {money(employee.netAmount, employee.currencyCode)} ·{' '}
                      {t('runs.conceptsCount', { count: employee.concepts.length })}
                    </p>
                    {employee.blockers.length > 0 && (
                      <p className="mt-1 text-xs text-warning-700">
                        {employee.blockers
                          .map(blocker => t(`runs.blockerLabels.${blocker}`))
                          .join('; ')}
                      </p>
                    )}
                    <details className="mt-2">
                      <summary>{t('runs.concepts')}</summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {employee.concepts.map(concept => (
                          <li key={concept.id}>
                            {concept.label}: {money(concept.amount, employee.currencyCode)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
              <nav className="flex gap-3" aria-label={t('runs.employeePages')}>
                <Button
                  variant="outline"
                  disabled={cursors.length === 0 || revision.isFetching}
                  onClick={() => setCursors(previous => previous.slice(0, -1))}
                >
                  {t('actions.previous')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!revision.data.nextCursor || revision.isFetching}
                  onClick={() => {
                    if (revision.data?.nextCursor)
                      setCursors(previous => [...previous, revision.data.nextCursor!]);
                  }}
                >
                  {t('actions.next')}
                </Button>
              </nav>
            </>
          ) : null}
          <details>
            <summary>{t('runs.events')}</summary>
            <ol className="mt-2 space-y-2">
              {detail.data.events.map(event => (
                <li key={event.id} className="rounded-lg border border-line p-2 text-sm">
                  {t(`runs.eventsKind.${event.kind}`)} ·{' '}
                  {t('runs.version', { version: event.version })}
                  <br />
                  {event.reason}
                </li>
              ))}
            </ol>
          </details>
          {detail.data.eventsTruncated && (
            <p role="alert" className="text-warning-700">
              {t('runs.eventsTruncated')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-xs text-secondary-500">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
