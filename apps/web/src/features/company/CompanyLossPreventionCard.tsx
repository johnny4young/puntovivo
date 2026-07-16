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
}

interface LossPreventionPolicy {
  version: 1;
  roles: Record<LossPreventionRole, RolePolicy>;
}

const ROLE_KEYS: readonly LossPreventionRole[] = ['cashier', 'manager'];
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function clonePolicy(policy: LossPreventionPolicy): LossPreventionPolicy {
  return {
    version: 1,
    roles: {
      cashier: {
        ...policy.roles.cashier,
        afterHoursSale: { ...policy.roles.cashier.afterHoursSale },
      },
      manager: {
        ...policy.roles.manager,
        afterHoursSale: { ...policy.roles.manager.afterHoursSale },
      },
    },
  };
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
    return (
      !Number.isFinite(value.maxDiscountPercent) ||
      value.maxDiscountPercent < 0 ||
      value.maxDiscountPercent > 100 ||
      !LOCAL_TIME_PATTERN.test(value.afterHoursSale.blockedFrom) ||
      !LOCAL_TIME_PATTERN.test(value.afterHoursSale.blockedUntil) ||
      (value.afterHoursSale.enabled &&
        value.afterHoursSale.blockedFrom === value.afterHoursSale.blockedUntil)
    );
  });
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
          if (!validationError && isDirty) {
            saveMutation.mutate({ roles: policy.roles });
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
              </fieldset>
            );
          })}
        </div>

        {validationError && (
          <p className="text-sm text-danger-700" role="alert">
            {t('settings:company.lossPrevention.validation')}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="max-w-2xl text-xs text-secondary-500">
            {t('settings:company.lossPrevention.auditNote')}
          </p>
          <button
            type="submit"
            className="pv-btn primary"
            disabled={saveMutation.isPending || validationError || !isDirty}
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
