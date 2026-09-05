import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import {
  parsePayrollMoney,
  payrollHoursToSeconds,
  type PayrollManualConcept,
  type PayrollPreparationEmployee,
  type PayrollRun,
  type PayrollSettlementInput,
} from './payrollTypes';

type ReviewChoice = 'review_required' | 'applies' | 'does_not_apply';
interface ConceptDraft {
  key: string;
  category: PayrollManualConcept['category'];
  code: string;
  label: string;
  amount: string;
  reason: string;
}
interface EmployeeDraft {
  selected: boolean;
  payrollDays: string;
  workedHours: string;
  employeeClassification: PayrollSettlementInput['employeeClassification'];
  holidayCalendarReviewed: boolean;
  employeeRestDayReviewed: boolean;
  contributionExemption: ReviewChoice;
  contributionBaseAmount: string;
  transportAssistance: ReviewChoice;
  withholdingStatus: 'review_required' | 'complete';
  withholdingAmount: string;
  benefitsReviewed: boolean;
  reviewReason: string;
  concepts: ConceptDraft[];
}
function conceptDraft(): ConceptDraft {
  return {
    key: crypto.randomUUID(),
    category: 'earning',
    code: '',
    label: '',
    amount: '',
    reason: '',
  };
}

function initialDraft(run: PayrollRun, employee: PayrollPreparationEmployee): EmployeeDraft {
  const adjustment = run.kind === 'adjustment';
  return {
    selected: true,
    payrollDays: adjustment ? '0' : employee.payBasis === 'monthly' ? '30' : '',
    workedHours: adjustment ? '0' : '',
    employeeClassification: adjustment ? 'private_cst' : 'review_required',
    holidayCalendarReviewed: adjustment,
    employeeRestDayReviewed: adjustment,
    contributionExemption: adjustment ? 'does_not_apply' : 'review_required',
    contributionBaseAmount: adjustment ? '0' : '',
    transportAssistance: adjustment ? 'does_not_apply' : 'review_required',
    withholdingStatus: adjustment ? 'complete' : 'review_required',
    withholdingAmount: adjustment ? '0' : '',
    benefitsReviewed: adjustment,
    reviewReason: '',
    concepts: adjustment ? [conceptDraft()] : [],
  };
}

function buildSettlement(
  employee: PayrollPreparationEmployee,
  draft: EmployeeDraft
): PayrollSettlementInput | null {
  if (employee.payBasis === null || employee.configurationBlockers.length > 0) return null;
  const monthly = employee.payBasis === 'monthly';
  const payrollDays = monthly && /^\d+$/.test(draft.payrollDays) ? Number(draft.payrollDays) : null;
  const ordinaryWorkedSeconds = monthly
    ? null
    : (employee.derivedWorkedSeconds ?? payrollHoursToSeconds(draft.workedHours));
  const contributionBaseAmount = draft.contributionBaseAmount.trim()
    ? parsePayrollMoney(draft.contributionBaseAmount)
    : null;
  const withholdingAmount = draft.withholdingAmount.trim()
    ? parsePayrollMoney(draft.withholdingAmount)
    : null;
  const concepts: PayrollManualConcept[] = [];
  for (const concept of draft.concepts) {
    const amount = parsePayrollMoney(concept.amount);
    if (
      amount === null ||
      !/^[a-z][a-z0-9_]{0,49}$/.test(concept.code.trim()) ||
      !concept.label.trim() ||
      concept.reason.trim().length < 10
    )
      return null;
    concepts.push({
      category: concept.category,
      code: concept.code.trim(),
      label: concept.label.trim(),
      amount,
      reason: concept.reason.trim(),
    });
  }
  if (
    (monthly && (payrollDays === null || payrollDays < 0 || payrollDays > 30)) ||
    (!monthly && ordinaryWorkedSeconds === null) ||
    draft.employeeClassification === 'review_required' ||
    draft.contributionExemption === 'review_required' ||
    draft.transportAssistance === 'review_required' ||
    !draft.holidayCalendarReviewed ||
    !draft.employeeRestDayReviewed ||
    !draft.benefitsReviewed ||
    draft.reviewReason.trim().length < 10 ||
    (draft.withholdingStatus === 'complete' && withholdingAmount === null)
  )
    return null;
  return {
    userId: employee.userId,
    payrollDays,
    ordinaryWorkedSeconds,
    employeeClassification: draft.employeeClassification,
    holidayCalendarReviewed: draft.holidayCalendarReviewed,
    employeeRestDayReviewed: draft.employeeRestDayReviewed,
    contributionExemption: draft.contributionExemption,
    contributionBaseAmount,
    transportAssistance: draft.transportAssistance,
    withholding:
      draft.withholdingStatus === 'complete'
        ? {
            status: 'complete',
            amount: withholdingAmount!,
            reason: draft.reviewReason.trim(),
          }
        : { status: 'review_required' },
    benefitsReviewed: draft.benefitsReviewed,
    reviewReason: draft.reviewReason.trim(),
    manualConcepts: concepts,
  };
}

/** Explicit review form; no statutory choice or amount is silently inferred by the UI. */
export function PayrollRecalculationForm({
  run,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  run: PayrollRun;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (
    employees: PayrollSettlementInput[],
    authorityToken: string,
    policyAcknowledged: boolean,
    reason: string
  ) => Promise<void>;
}) {
  const { t } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const preparation = trpc.workforce.payroll.runs.preparation.useQuery(
    { runId: run.id },
    { gcTime: 0, staleTime: 0 }
  );
  const eligible = preparation.data?.employees ?? [];
  const [drafts, setDrafts] = useState<Record<string, EmployeeDraft>>({});
  const [policyAcknowledged, setPolicyAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const loading = preparation.isPending;
  const failure = preparation.error;
  const attendanceBlocked = eligible.some(employee => employee.attendanceBlockers.length > 0);
  const preparationStale =
    preparation.data !== undefined && preparation.data.runVersion !== run.version;

  function draftFor(employee: PayrollPreparationEmployee): EmployeeDraft {
    return drafts[employee.userId] ?? initialDraft(run, employee);
  }
  function update(
    userId: string,
    employee: PayrollPreparationEmployee,
    change: Partial<EmployeeDraft>
  ) {
    setDrafts(previous => ({
      ...previous,
      [userId]: { ...(previous[userId] ?? initialDraft(run, employee)), ...change },
    }));
  }
  function submit() {
    const selected = eligible.filter(employee => draftFor(employee).selected);
    const rows = selected.map(employee => buildSettlement(employee, draftFor(employee)));
    if (
      !policyAcknowledged ||
      !preparation.data?.ready ||
      attendanceBlocked ||
      preparationStale ||
      reason.trim().length < 10 ||
      selected.length === 0 ||
      rows.some(row => row === null)
    ) {
      setValidationError(t('runs.recalculate.validation'));
      return;
    }
    setValidationError(null);
    void onSubmit(
      rows as PayrollSettlementInput[],
      preparation.data.authorityToken,
      policyAcknowledged,
      reason.trim()
    );
  }

  return (
    <Modal
      isOpen
      title={t('runs.recalculate.title')}
      size="xl"
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
            disabled={
              saving ||
              loading ||
              !!failure ||
              !preparation.data?.ready ||
              attendanceBlocked ||
              preparationStale
            }
            onClick={submit}
          >
            {t(saving ? 'actions.saving' : 'runs.actions.recalculate')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-warning-300 bg-warning-50 p-4 text-sm text-warning-900">
          <p className="font-semibold">{t('runs.recalculate.noticeTitle')}</p>
          <p className="mt-1">
            {t(
              run.kind === 'adjustment'
                ? 'runs.recalculate.adjustmentNotice'
                : 'runs.recalculate.notice'
            )}
          </p>
        </div>
        {loading && <p role="status">{t('actions.loading')}</p>}
        {failure && (
          <p role="alert" className="text-danger-700">
            {translateServerError(failure, t, t('runs.loadError'))}
          </p>
        )}
        {preparation.data && !preparation.data.ready && (
          <p role="alert" className="text-warning-700">
            {t('runs.recalculate.preparationBlocked')}
          </p>
        )}
        {preparationStale && (
          <p role="alert" className="text-warning-700">
            {t('runs.recalculate.preparationStale')}
          </p>
        )}
        {!loading && !failure && eligible.length === 0 && (
          <p role="alert">{t('runs.recalculate.noEligible')}</p>
        )}
        {eligible.map(employee => {
          const draft = draftFor(employee);
          const monthly = employee.payBasis === 'monthly';
          const configured = employee.configurationBlockers.length === 0;
          const attendanceHoursAreAuthoritative =
            !monthly && employee.derivedWorkedSeconds !== null;
          return (
            <article key={employee.userId} className="space-y-4 rounded-xl border border-line p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={draft.selected}
                  disabled={saving || run.kind === 'regular' || !configured}
                  onChange={event =>
                    update(employee.userId, employee, { selected: event.target.checked })
                  }
                />
                <span>
                  <span className="block font-semibold">
                    {employee.userName ?? t('runs.recalculate.unknownEmployee')}
                  </span>
                  <span className="block text-xs text-secondary-500">
                    {employee.siteName ?? t('runs.recalculate.unknownSite')}
                    {employee.payBasis && (
                      <> · {t(`runs.recalculate.basis.${employee.payBasis}`)}</>
                    )}
                  </span>
                  {(employee.userActive === false || employee.siteActive === false) && (
                    <span className="block text-xs text-warning-700">
                      {t('runs.recalculate.historicalInactive')}
                    </span>
                  )}
                </span>
              </label>
              {!configured && (
                <div role="alert" className="text-sm text-danger-700">
                  <p>{t('runs.recalculate.employeeConfigurationBlocked')}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {employee.configurationBlockers.map(blocker => (
                      <li key={blocker}>
                        {t(`runs.recalculate.configurationBlockers.${blocker}`)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {employee.attendanceBlockers.length > 0 && (
                <div role="alert" className="text-sm text-danger-700">
                  <p>{t('runs.recalculate.attendanceBlocked')}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {employee.attendanceBlockers.map(blocker => (
                      <li key={blocker}>{t(`runs.blockerLabels.${blocker}`)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {employee.payBasis === 'hourly' && employee.derivedWorkedSeconds !== null && (
                <p className="text-sm text-secondary-600">
                  {t('runs.recalculate.derivedWorkedHours', {
                    hours: employee.derivedWorkedSeconds / 3600,
                  })}
                </p>
              )}
              {draft.selected && configured && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block">
                    <span className="label">
                      {t(monthly ? 'runs.recalculate.payrollDays' : 'runs.recalculate.workedHours')}
                    </span>
                    <input
                      className="input mt-1"
                      inputMode="decimal"
                      value={
                        monthly
                          ? draft.payrollDays
                          : attendanceHoursAreAuthoritative
                            ? String(employee.derivedWorkedSeconds! / 3600)
                            : draft.workedHours
                      }
                      disabled={saving || attendanceHoursAreAuthoritative}
                      onChange={event =>
                        update(
                          employee.userId,
                          employee,
                          monthly
                            ? { payrollDays: event.target.value }
                            : { workedHours: event.target.value }
                        )
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="label">{t('runs.recalculate.classification')}</span>
                    <select
                      className="input mt-1"
                      value={draft.employeeClassification}
                      disabled={saving}
                      onChange={event =>
                        update(employee.userId, employee, {
                          employeeClassification: event.target
                            .value as EmployeeDraft['employeeClassification'],
                        })
                      }
                    >
                      {(['review_required', 'private_cst', 'unsupported'] as const).map(value => (
                        <option key={value} value={value}>
                          {t(`runs.recalculate.classifications.${value}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ReviewSelect
                    label={t('runs.recalculate.contributionExemption')}
                    value={draft.contributionExemption}
                    disabled={saving}
                    onChange={value =>
                      update(employee.userId, employee, { contributionExemption: value })
                    }
                    t={t}
                  />
                  <label className="block">
                    <span className="label">{t('runs.recalculate.contributionBase')}</span>
                    <input
                      className="input mt-1"
                      inputMode="decimal"
                      value={draft.contributionBaseAmount}
                      disabled={saving}
                      onChange={event =>
                        update(employee.userId, employee, {
                          contributionBaseAmount: event.target.value,
                        })
                      }
                    />
                  </label>
                  <ReviewSelect
                    label={t('runs.recalculate.transportAssistance')}
                    value={draft.transportAssistance}
                    disabled={saving}
                    onChange={value =>
                      update(employee.userId, employee, { transportAssistance: value })
                    }
                    t={t}
                  />
                  <label className="block">
                    <span className="label">{t('runs.recalculate.withholding')}</span>
                    <select
                      className="input mt-1"
                      value={draft.withholdingStatus}
                      disabled={saving}
                      onChange={event =>
                        update(employee.userId, employee, {
                          withholdingStatus: event.target
                            .value as EmployeeDraft['withholdingStatus'],
                        })
                      }
                    >
                      <option value="review_required">
                        {t('runs.recalculate.reviewRequired')}
                      </option>
                      <option value="complete">{t('runs.recalculate.reviewComplete')}</option>
                    </select>
                  </label>
                  {draft.withholdingStatus === 'complete' && (
                    <label className="block">
                      <span className="label">{t('runs.recalculate.withholdingAmount')}</span>
                      <input
                        className="input mt-1"
                        inputMode="decimal"
                        value={draft.withholdingAmount}
                        disabled={saving}
                        onChange={event =>
                          update(employee.userId, employee, {
                            withholdingAmount: event.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                  {(
                    [
                      ['holidayCalendarReviewed', 'runs.recalculate.holidayReviewed'],
                      ['employeeRestDayReviewed', 'runs.recalculate.restDayReviewed'],
                      ['benefitsReviewed', 'runs.recalculate.benefitsReviewed'],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft[field]}
                        disabled={saving}
                        onChange={event =>
                          update(employee.userId, employee, {
                            [field]: event.target.checked,
                          })
                        }
                      />
                      {t(label)}
                    </label>
                  ))}
                  <label className="block sm:col-span-2 lg:col-span-3">
                    <span className="label">{t('runs.recalculate.reviewReason')}</span>
                    <textarea
                      className="input mt-1 min-h-20"
                      maxLength={500}
                      value={draft.reviewReason}
                      disabled={saving}
                      onChange={event =>
                        update(employee.userId, employee, {
                          reviewReason: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="space-y-3 sm:col-span-2 lg:col-span-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="font-medium">{t('runs.recalculate.manualConcepts')}</h4>
                      <Button
                        variant="outline"
                        size="compact"
                        disabled={saving || draft.concepts.length >= 100}
                        onClick={() =>
                          update(employee.userId, employee, {
                            concepts: [...draft.concepts, conceptDraft()],
                          })
                        }
                      >
                        {t('runs.recalculate.addConcept')}
                      </Button>
                    </div>
                    {draft.concepts.map(concept => (
                      <ConceptFields
                        key={concept.key}
                        concept={concept}
                        disabled={saving}
                        onChange={next =>
                          update(employee.userId, employee, {
                            concepts: draft.concepts.map(item =>
                              item.key === concept.key ? next : item
                            ),
                          })
                        }
                        onRemove={() =>
                          update(employee.userId, employee, {
                            concepts: draft.concepts.filter(item => item.key !== concept.key),
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={policyAcknowledged}
            disabled={saving}
            onChange={event => setPolicyAcknowledged(event.target.checked)}
          />
          {t('runs.recalculate.policyAcknowledged')}
        </label>
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
        {(validationError || error) && (
          <p role="alert" className="text-danger-700">
            {validationError ?? error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function ReviewSelect({
  label,
  value,
  disabled,
  onChange,
  t,
}: {
  label: string;
  value: ReviewChoice;
  disabled: boolean;
  onChange: (value: ReviewChoice) => void;
  t: (key: string) => string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select
        className="input mt-1"
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value as ReviewChoice)}
      >
        {(['review_required', 'applies', 'does_not_apply'] as const).map(option => (
          <option key={option} value={option}>
            {t(`runs.recalculate.reviewChoices.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ConceptFields({
  concept,
  disabled,
  onChange,
  onRemove,
}: {
  concept: ConceptDraft;
  disabled: boolean;
  onChange: (concept: ConceptDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('payroll');
  return (
    <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block">
        <span className="label">{t('runs.recalculate.conceptCategory')}</span>
        <select
          className="input mt-1"
          value={concept.category}
          disabled={disabled}
          onChange={event =>
            onChange({ ...concept, category: event.target.value as ConceptDraft['category'] })
          }
        >
          {(['earning', 'deduction', 'employer_contribution'] as const).map(value => (
            <option key={value} value={value}>
              {t(`runs.recalculate.categories.${value}`)}
            </option>
          ))}
        </select>
      </label>
      {(['code', 'label', 'amount'] as const).map(field => (
        <label className="block" key={field}>
          <span className="label">
            {t(`runs.recalculate.concept${field[0]!.toUpperCase()}${field.slice(1)}`)}
          </span>
          <input
            className="input mt-1"
            value={concept[field]}
            disabled={disabled}
            onChange={event => onChange({ ...concept, [field]: event.target.value })}
          />
        </label>
      ))}
      <Button variant="danger" size="compact" disabled={disabled} onClick={onRemove}>
        {t('runs.recalculate.removeConcept')}
      </Button>
      <label className="block sm:col-span-2 lg:col-span-5">
        <span className="label">{t('runs.recalculate.conceptReason')}</span>
        <textarea
          className="input mt-1 min-h-16"
          maxLength={500}
          value={concept.reason}
          disabled={disabled}
          onChange={event => onChange({ ...concept, reason: event.target.value })}
        />
      </label>
    </div>
  );
}
