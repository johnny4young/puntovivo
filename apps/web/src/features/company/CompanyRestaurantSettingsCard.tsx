/**
 * ENG-039d3 — Admin-only card for restaurant-mode tenant settings.
 *
 * Sits inside `CompanyPage`'s admin "restaurant" tab. Reads
 * `restaurantSettings.get`, writes via `restaurantSettings.update`,
 * and invalidates the query on success so admins see the persisted
 * value immediately.
 *
 * v1 surfaces a single field — `serviceChargeRate` (0–30%). The
 * default of 0 disables the service-charge line at checkout, so
 * non-restaurant tenants pay zero contract cost.
 *
 * Note: the rate that drives `SalePaymentModal` flows through the
 * `auth.me` session payload (cached on login). Cashiers see updates
 * on their next login. Admins running the cart on the same window
 * either re-login or refresh the page to reflect changes here.
 */
import { useState } from 'react';
import { Utensils } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

const SERVICE_CHARGE_MAX = 30;

function clampRateInput(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, SERVICE_CHARGE_MAX);
}

export function CompanyRestaurantSettingsCard() {
  const { t } = useTranslation(['settings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.restaurantSettings.get.useQuery();
  const [rateInput, setRateInput] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const persistedRate = settingsQuery.data?.serviceChargeRate ?? 0;
  const inputValue = rateInput ?? String(persistedRate);

  const updateMutation = trpc.restaurantSettings.update.useMutation({
    onSuccess: async () => {
      await utils.restaurantSettings.get.invalidate();
      setRateInput(null);
      toast.success({ title: t('settings:company.restaurant.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.restaurant.toast.saveError',
    }),
  });

  function handleChange(value: string): void {
    setRateInput(value);
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > SERVICE_CHARGE_MAX) {
      setRangeError(
        t('settings:company.restaurant.serviceChargeRangeError', {
          max: SERVICE_CHARGE_MAX,
        })
      );
    } else {
      setRangeError(null);
    }
  }

  function handleSave(): void {
    if (rangeError) return;
    const next = clampRateInput(inputValue);
    void updateMutation.mutateAsync({ serviceChargeRate: next });
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Utensils className="h-5 w-5 text-primary-700" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-secondary-950">
            {t('settings:company.restaurant.title')}
          </h2>
          <p className="text-sm text-secondary-600">
            {t('settings:company.restaurant.description')}
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="company-restaurant-service-rate"
          className="label"
        >
          {t('settings:company.restaurant.serviceChargeLabel')}
        </label>
        <input
          id="company-restaurant-service-rate"
          type="number"
          inputMode="decimal"
          min={0}
          max={SERVICE_CHARGE_MAX}
          step="0.1"
          className="input mt-1 max-w-[160px]"
          value={inputValue}
          onChange={event => handleChange(event.target.value)}
          aria-describedby="company-restaurant-service-rate-help"
          disabled={settingsQuery.isLoading || updateMutation.isPending}
        />
        <p
          id="company-restaurant-service-rate-help"
          className="mt-1 text-xs text-secondary-500"
        >
          {t('settings:company.restaurant.serviceChargeHelp', {
            max: SERVICE_CHARGE_MAX,
          })}
        </p>
        {rangeError && (
          <p className="mt-1 text-sm text-danger-500" role="alert">
            {rangeError}
          </p>
        )}
        {persistedRate === 0 && !rateInput && (
          <p className="mt-1 text-xs text-secondary-500">
            {t('settings:company.restaurant.serviceChargeDisabledHint')}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={
            settingsQuery.isLoading ||
            updateMutation.isPending ||
            rangeError !== null
          }
        >
          {updateMutation.isPending
            ? t('settings:company.restaurant.saving')
            : t('settings:company.restaurant.save')}
        </button>
      </div>
    </div>
  );
}
