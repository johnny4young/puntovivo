/**
 * Admin-only card for restaurant-mode tenant settings.
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
import { Button } from '@/components/ui';
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
      toast.success({
        title: t('settings:company.restaurant.toast.saved'),
      });
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
    void updateMutation.mutateAsync({
      serviceChargeRate: next,
    });
  }
  const disabled = settingsQuery.isLoading || updateMutation.isPending;
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-warning-50 text-warning-700">
          <Utensils className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="pv-title text-lg">{t('settings:company.restaurant.title')}</h2>
          <p className="mt-1 text-sm text-fg3">{t('settings:company.restaurant.description')}</p>
        </div>
      </div>

      <div className="mt-5 max-w-xs">
        <div className="pv-field">
          <label htmlFor="company-restaurant-service-rate" className="label">
            {t('settings:company.restaurant.serviceChargeLabel')}
          </label>
          <span className={`pv-input mono${rangeError ? ' error' : ''}`}>
            <input
              id="company-restaurant-service-rate"
              type="number"
              inputMode="decimal"
              min={0}
              max={SERVICE_CHARGE_MAX}
              step="0.1"
              className="w-full border-0 bg-transparent p-0 font-mono text-[13.5px] text-fg1 outline-none focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
              value={inputValue}
              onChange={event => handleChange(event.target.value)}
              aria-describedby="company-restaurant-service-rate-help"
              aria-invalid={rangeError ? true : undefined}
              disabled={disabled}
            />
          </span>
          <p id="company-restaurant-service-rate-help" className="help">
            {t('settings:company.restaurant.serviceChargeHelp', {
              max: SERVICE_CHARGE_MAX,
            })}
          </p>
          {rangeError && (
            <p className="err-msg" role="alert">
              {rangeError}
            </p>
          )}
          {persistedRate === 0 && !rateInput && !rangeError && (
            <p className="help">{t('settings:company.restaurant.serviceChargeDisabledHint')}</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          onClick={handleSave}
          disabled={disabled || rangeError !== null}
          variant="primary"
        >
          {updateMutation.isPending
            ? t('settings:company.restaurant.saving')
            : t('settings:company.restaurant.save')}
        </Button>
      </div>
    </section>
  );
}
