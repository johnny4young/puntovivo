import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

type LossPreventionRole = 'cashier' | 'manager';

interface AfterHoursPolicy {
  enabled: boolean;
  blockedFrom: string;
  blockedUntil: string;
}

interface RolePolicy {
  maxDiscountPercent: number;
  afterHoursSale: AfterHoursPolicy;
  shift: {
    refunds: ShiftValuePolicy;
    voids: ShiftValuePolicy;
    noSale: NoSalePolicy;
  };
  dualApproval: {
    enabled: boolean;
    thresholdAmount: number;
  };
}

interface ShiftValuePolicy {
  enabled: boolean;
  maxCount: number;
  maxAmount: number;
}

interface NoSalePolicy {
  enabled: boolean;
  maxCount: number;
}

interface LossPreventionPolicy {
  version: 4;
  roles: Record<LossPreventionRole, RolePolicy>;
  alerts: {
    whatsappHandoff: {
      enabled: boolean;
      recipientPhone: string;
    };
  };
}

const ROLE_KEYS: readonly LossPreventionRole[] = ['cashier', 'manager'];
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function clonePolicy(policy: LossPreventionPolicy): LossPreventionPolicy {
  return {
    version: 4,
    roles: {
      cashier: {
        ...policy.roles.cashier,
        afterHoursSale: { ...policy.roles.cashier.afterHoursSale },
        shift: {
          refunds: { ...policy.roles.cashier.shift.refunds },
          voids: { ...policy.roles.cashier.shift.voids },
          noSale: { ...policy.roles.cashier.shift.noSale },
        },
        dualApproval: { ...policy.roles.cashier.dualApproval },
      },
      manager: {
        ...policy.roles.manager,
        afterHoursSale: { ...policy.roles.manager.afterHoursSale },
        shift: {
          refunds: { ...policy.roles.manager.shift.refunds },
          voids: { ...policy.roles.manager.shift.voids },
          noSale: { ...policy.roles.manager.shift.noSale },
        },
        dualApproval: { ...policy.roles.manager.dualApproval },
      },
    },
    alerts: {
      whatsappHandoff: { ...policy.alerts.whatsappHandoff },
    },
  };
}

function isValidWhatsAppRecipient(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/[\s().-]/g, '')
    .replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(normalized);
}

/** ENG-142a — admin policy editor for local, per-role checkout controls. */
export function CompanyLossPreventionCard(): React.ReactElement {
  const { t } = useTranslation(['settings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.lossPrevention.getSettings.useQuery();
  const [draft, setDraft] = useState<LossPreventionPolicy | null>(null);
  const persisted = settingsQuery.data as LossPreventionPolicy | undefined;
  const policy = draft ?? persisted ?? null;

  const saveMutation = useCriticalMutation('lossPrevention.updateSettings', {
    onSuccess: saved => {
      utils.lossPrevention.getSettings.setData(undefined, saved);
      setDraft(null);
      toast.success({ title: t('settings:company.lossPrevention.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.lossPrevention.toast.saveError',
    }),
  });

  const updateRole = (role: LossPreventionRole, update: (current: RolePolicy) => RolePolicy) => {
    if (!policy) return;
    setDraft(current => {
      const next = clonePolicy(current ?? policy);
      next.roles[role] = update(next.roles[role]);
      return next;
    });
  };

  if (settingsQuery.isLoading) {
    return (
      <section className="card p-6" data-testid="company-loss-prevention-card">
        <PageLoadingState
          title={t('settings:company.lossPrevention.title')}
          description={t('settings:company.lossPrevention.loading')}
        />
      </section>
    );
  }

  if (settingsQuery.error || !policy || !persisted) {
    return (
      <section className="card p-6" data-testid="company-loss-prevention-card">
        <QueryErrorState
          title={t('settings:company.lossPrevention.title')}
          message={translateServerError(settingsQuery.error, t, t('errors:server.unknown'))}
          onRetry={() => void settingsQuery.refetch()}
        />
      </section>
    );
  }

  const validationError = ROLE_KEYS.some(role => {
    const value = policy.roles[role];
    const shiftValues = [value.shift.refunds, value.shift.voids];
    return (
      !Number.isFinite(value.maxDiscountPercent) ||
      value.maxDiscountPercent < 0 ||
      value.maxDiscountPercent > 100 ||
      !LOCAL_TIME_PATTERN.test(value.afterHoursSale.blockedFrom) ||
      !LOCAL_TIME_PATTERN.test(value.afterHoursSale.blockedUntil) ||
      (value.afterHoursSale.enabled &&
        value.afterHoursSale.blockedFrom === value.afterHoursSale.blockedUntil) ||
      shiftValues.some(
        limit =>
          !Number.isInteger(limit.maxCount) ||
          limit.maxCount < 0 ||
          limit.maxCount > 1000 ||
          !Number.isFinite(limit.maxAmount) ||
          limit.maxAmount < 0 ||
          limit.maxAmount > 1_000_000_000_000
      ) ||
      !Number.isInteger(value.shift.noSale.maxCount) ||
      value.shift.noSale.maxCount < 0 ||
      value.shift.noSale.maxCount > 1000 ||
      !Number.isFinite(value.dualApproval.thresholdAmount) ||
      value.dualApproval.thresholdAmount < 0 ||
      value.dualApproval.thresholdAmount > 1_000_000_000_000
    );
  });
  const alertValidationError =
    policy.alerts.whatsappHandoff.enabled &&
    !isValidWhatsAppRecipient(policy.alerts.whatsappHandoff.recipientPhone);
  const isDirty = JSON.stringify(policy) !== JSON.stringify(persisted);

  return (
    <section
      className="card space-y-5 p-6"
      data-testid="company-loss-prevention-card"
      aria-labelledby="loss-prevention-title"
    >
      <div className="flex items-start gap-3">
        <span className="pv-gt pv-gt-warning h-10 w-10">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="loss-prevention-title" className="text-lg font-semibold text-secondary-950">
            {t('settings:company.lossPrevention.title')}
          </h2>
          <p className="mt-1 text-sm text-secondary-500">
            {t('settings:company.lossPrevention.description')}
          </p>
        </div>
      </div>

      <form
        className="space-y-5"
        onSubmit={event => {
          event.preventDefault();
          if (!validationError && !alertValidationError && isDirty) {
            saveMutation.mutate({ roles: policy.roles, alerts: policy.alerts });
          }
        }}
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {ROLE_KEYS.map(role => {
            const rolePolicy = policy.roles[role];
            const discountId = `loss-prevention-${role}-discount`;
            const enabledId = `loss-prevention-${role}-after-hours`;
            return (
              <fieldset
                key={role}
                className="rounded-2xl border border-line bg-surface-2 p-4"
                disabled={saveMutation.isPending}
                data-testid={`loss-prevention-role-${role}`}
              >
                <legend className="px-1 text-sm font-semibold text-secondary-950">
                  {t(`settings:company.lossPrevention.roles.${role}`)}
                </legend>

                <div className="mt-2">
                  <label htmlFor={discountId} className="label">
                    {t('settings:company.lossPrevention.maxDiscount.label')}
                  </label>
                  <div className="relative mt-1">
                    <input
                      id={discountId}
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      className="input pr-9"
                      value={rolePolicy.maxDiscountPercent}
                      onChange={event =>
                        updateRole(role, current => ({
                          ...current,
                          maxDiscountPercent: Number(event.target.value),
                        }))
                      }
                    />
                    <span
                      className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-secondary-500"
                      aria-hidden="true"
                    >
                      %
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-secondary-500">
                    {t('settings:company.lossPrevention.maxDiscount.help')}
                  </p>
                </div>

                <label htmlFor={enabledId} className="mt-5 flex items-start gap-3">
                  <input
                    id={enabledId}
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
                    checked={rolePolicy.afterHoursSale.enabled}
                    onChange={event =>
                      updateRole(role, current => ({
                        ...current,
                        afterHoursSale: {
                          ...current.afterHoursSale,
                          enabled: event.target.checked,
                        },
                      }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-secondary-900">
                      {t('settings:company.lossPrevention.afterHours.label')}
                    </span>
                    <span className="mt-0.5 block text-xs text-secondary-500">
                      {t('settings:company.lossPrevention.afterHours.help')}
                    </span>
                  </span>
                </label>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`${enabledId}-from`} className="label">
                      {t('settings:company.lossPrevention.afterHours.from')}
                    </label>
                    <input
                      id={`${enabledId}-from`}
                      type="time"
                      required
                      className="input mt-1"
                      value={rolePolicy.afterHoursSale.blockedFrom}
                      onChange={event =>
                        updateRole(role, current => ({
                          ...current,
                          afterHoursSale: {
                            ...current.afterHoursSale,
                            blockedFrom: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`${enabledId}-until`} className="label">
                      {t('settings:company.lossPrevention.afterHours.until')}
                    </label>
                    <input
                      id={`${enabledId}-until`}
                      type="time"
                      required
                      className="input mt-1"
                      value={rolePolicy.afterHoursSale.blockedUntil}
                      onChange={event =>
                        updateRole(role, current => ({
                          ...current,
                          afterHoursSale: {
                            ...current.afterHoursSale,
                            blockedUntil: event.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="mt-5 rounded-xl border border-line bg-surface p-3">
                  <label
                    htmlFor={`loss-prevention-${role}-dual-approval-enabled`}
                    className="flex items-start gap-3"
                  >
                    <input
                      id={`loss-prevention-${role}-dual-approval-enabled`}
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
                      checked={rolePolicy.dualApproval.enabled}
                      onChange={event =>
                        updateRole(role, current => ({
                          ...current,
                          dualApproval: {
                            ...current.dualApproval,
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-secondary-900">
                        {t('settings:company.lossPrevention.dualApproval.label')}
                      </span>
                      <span className="mt-0.5 block text-xs text-secondary-500">
                        {t('settings:company.lossPrevention.dualApproval.help')}
                      </span>
                    </span>
                  </label>
                  <div className="mt-3">
                    <label
                      htmlFor={`loss-prevention-${role}-dual-approval-threshold`}
                      className="label"
                    >
                      {t('settings:company.lossPrevention.dualApproval.threshold')}
                    </label>
                    <input
                      id={`loss-prevention-${role}-dual-approval-threshold`}
                      type="number"
                      min={0}
                      max={1_000_000_000_000}
                      step={0.01}
                      className="input mt-1"
                      value={rolePolicy.dualApproval.thresholdAmount}
                      onChange={event =>
                        updateRole(role, current => ({
                          ...current,
                          dualApproval: {
                            ...current.dualApproval,
                            thresholdAmount: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="text-sm font-semibold text-secondary-950">
                    {t('settings:company.lossPrevention.shift.title')}
                  </h3>
                  <p className="mt-1 text-xs text-secondary-500">
                    {t('settings:company.lossPrevention.shift.help')}
                  </p>

                  {(['refunds', 'voids'] as const).map(action => {
                    const rule = rolePolicy.shift[action];
                    const actionId = `loss-prevention-${role}-${action}`;
                    return (
                      <div
                        key={action}
                        className="mt-4 rounded-xl border border-line bg-surface p-3"
                      >
                        <label htmlFor={`${actionId}-enabled`} className="flex items-start gap-3">
                          <input
                            id={`${actionId}-enabled`}
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
                            checked={rule.enabled}
                            onChange={event =>
                              updateRole(role, current => ({
                                ...current,
                                shift: {
                                  ...current.shift,
                                  [action]: {
                                    ...current.shift[action],
                                    enabled: event.target.checked,
                                  },
                                },
                              }))
                            }
                          />
                          <span>
                            <span
                              id={`${actionId}-label`}
                              className="block text-sm font-medium text-secondary-900"
                            >
                              {t(`settings:company.lossPrevention.shift.${action}.label`)}
                            </span>
                            <span className="mt-0.5 block text-xs text-secondary-500">
                              {t(`settings:company.lossPrevention.shift.${action}.help`)}
                            </span>
                          </span>
                        </label>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div>
                            <label
                              id={`${actionId}-count-label`}
                              htmlFor={`${actionId}-count`}
                              className="label"
                            >
                              {t('settings:company.lossPrevention.shift.maxCount')}
                            </label>
                            <input
                              id={`${actionId}-count`}
                              aria-labelledby={`${actionId}-label ${actionId}-count-label`}
                              type="number"
                              min={0}
                              max={1000}
                              step={1}
                              className="input mt-1"
                              value={rule.maxCount}
                              onChange={event =>
                                updateRole(role, current => ({
                                  ...current,
                                  shift: {
                                    ...current.shift,
                                    [action]: {
                                      ...current.shift[action],
                                      maxCount: Number(event.target.value),
                                    },
                                  },
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label
                              id={`${actionId}-amount-label`}
                              htmlFor={`${actionId}-amount`}
                              className="label"
                            >
                              {t('settings:company.lossPrevention.shift.maxAmount')}
                            </label>
                            <input
                              id={`${actionId}-amount`}
                              aria-labelledby={`${actionId}-label ${actionId}-amount-label`}
                              type="number"
                              min={0}
                              max={1_000_000_000_000}
                              step={0.01}
                              className="input mt-1"
                              value={rule.maxAmount}
                              onChange={event =>
                                updateRole(role, current => ({
                                  ...current,
                                  shift: {
                                    ...current.shift,
                                    [action]: {
                                      ...current.shift[action],
                                      maxAmount: Number(event.target.value),
                                    },
                                  },
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="mt-4 rounded-xl border border-line bg-surface p-3">
                    <label
                      htmlFor={`loss-prevention-${role}-no-sale-enabled`}
                      className="flex items-start gap-3"
                    >
                      <input
                        id={`loss-prevention-${role}-no-sale-enabled`}
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
                        checked={rolePolicy.shift.noSale.enabled}
                        onChange={event =>
                          updateRole(role, current => ({
                            ...current,
                            shift: {
                              ...current.shift,
                              noSale: { ...current.shift.noSale, enabled: event.target.checked },
                            },
                          }))
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium text-secondary-900">
                          {t('settings:company.lossPrevention.shift.noSale.label')}
                        </span>
                        <span className="mt-0.5 block text-xs text-secondary-500">
                          {t('settings:company.lossPrevention.shift.noSale.help')}
                        </span>
                      </span>
                    </label>
                    <div className="mt-3">
                      <label htmlFor={`loss-prevention-${role}-no-sale-count`} className="label">
                        {t('settings:company.lossPrevention.shift.noSale.maxCount')}
                      </label>
                      <input
                        id={`loss-prevention-${role}-no-sale-count`}
                        type="number"
                        min={0}
                        max={1000}
                        step={1}
                        className="input mt-1"
                        value={rolePolicy.shift.noSale.maxCount}
                        onChange={event =>
                          updateRole(role, current => ({
                            ...current,
                            shift: {
                              ...current.shift,
                              noSale: {
                                ...current.shift.noSale,
                                maxCount: Number(event.target.value),
                              },
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </fieldset>
            );
          })}
        </div>

        <section
          className="rounded-2xl border border-line bg-surface-2 p-4"
          aria-labelledby="loss-prevention-alert-delivery-title"
        >
          <h3
            id="loss-prevention-alert-delivery-title"
            className="text-sm font-semibold text-secondary-950"
          >
            {t('settings:company.lossPrevention.alerts.title')}
          </h3>
          <p className="mt-1 text-xs text-secondary-500">
            {t('settings:company.lossPrevention.alerts.inAppHelp')}
          </p>
          <div className="mt-4 rounded-xl border border-line bg-surface p-3">
            <label htmlFor="loss-prevention-whatsapp-handoff" className="flex items-start gap-3">
              <input
                id="loss-prevention-whatsapp-handoff"
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
                checked={policy.alerts.whatsappHandoff.enabled}
                disabled={saveMutation.isPending}
                onChange={event => {
                  const enabled = event.target.checked;
                  setDraft(current => {
                    const next = clonePolicy(current ?? policy);
                    next.alerts.whatsappHandoff.enabled = enabled;
                    return next;
                  });
                }}
              />
              <span>
                <span className="block text-sm font-medium text-secondary-900">
                  {t('settings:company.lossPrevention.alerts.whatsapp.label')}
                </span>
                <span className="mt-0.5 block text-xs text-secondary-500">
                  {t('settings:company.lossPrevention.alerts.whatsapp.help')}
                </span>
              </span>
            </label>
            <div className="mt-3 max-w-sm">
              <label htmlFor="loss-prevention-whatsapp-recipient" className="label">
                {t('settings:company.lossPrevention.alerts.whatsapp.recipient')}
              </label>
              <input
                id="loss-prevention-whatsapp-recipient"
                type="tel"
                autoComplete="tel"
                className="input mt-1"
                value={policy.alerts.whatsappHandoff.recipientPhone}
                disabled={saveMutation.isPending}
                placeholder={t('settings:company.lossPrevention.alerts.whatsapp.placeholder')}
                onChange={event => {
                  const recipientPhone = event.target.value;
                  setDraft(current => {
                    const next = clonePolicy(current ?? policy);
                    next.alerts.whatsappHandoff.recipientPhone = recipientPhone;
                    return next;
                  });
                }}
              />
            </div>
          </div>
        </section>

        {(validationError || alertValidationError) && (
          <p className="text-sm text-danger-700" role="alert">
            {alertValidationError
              ? t('settings:company.lossPrevention.alerts.whatsapp.validation')
              : t('settings:company.lossPrevention.validation')}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-2xl text-xs text-secondary-500">
            {t('settings:company.lossPrevention.auditNote')}
          </p>
          <button
            type="submit"
            className="pv-btn primary"
            disabled={saveMutation.isPending || validationError || alertValidationError || !isDirty}
          >
            {saveMutation.isPending
              ? t('settings:company.lossPrevention.saving')
              : t('settings:company.lossPrevention.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
