/**
 * ENG-214 — Admin-only card for the tenant's loyalty program (ENG-213).
 *
 * Sits inside `CompanyPage`'s "general" tab beside the cash-close and
 * discount cards. Reads `loyalty.settings`, writes via
 * `loyalty.updateSettings`, and invalidates on success.
 *
 * Unit inversion is the point of this card. The server stores
 * `pointsPerUnit` (0.001 = one point per $1.000) because the accrual is a
 * multiplication, but "0.001" is a number only the implementer can read.
 * The operator thinks in the WC-D2 spec's own phrasing — "how much does a
 * point cost?" — so the input is currency-per-point and the card converts
 * on the way in and out. The live example line below the field is the real
 * validation: the admin sees what a $50.000 sale would earn before saving.
 */
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

/**
 * Sale total used for the "what would this earn?" preview. A round,
 * mid-basket number so the example reads instantly at any sane rate.
 */
const PREVIEW_SALE_TOTAL = 50_000;

/**
 * Currency per point must keep `pointsPerUnit = 1 / value` inside the
 * server's (0, 100] bound; 0.01 is where that bound bites. The floor is 1
 * anyway because a sub-unit point price is nonsense in every LATAM currency
 * this ships to.
 */
const MIN_CURRENCY_PER_POINT = 1;

/** Server rate (points per currency unit) → operator rate (currency per point). */
function toCurrencyPerPoint(pointsPerUnit: number): number {
  if (!Number.isFinite(pointsPerUnit) || pointsPerUnit <= 0) return 1000;
  // Round-trips through IEEE754 land a hair off (1 / 0.001 = 999.999…), so
  // snap to 2 decimals — the operator typed a round number, show it back.
  return Number((1 / pointsPerUnit).toFixed(2));
}

/** Operator rate → server rate. */
function toPointsPerUnit(currencyPerPoint: number): number {
  return 1 / currencyPerPoint;
}

export function CompanyLoyaltySettingsCard() {
  const { t } = useTranslation(['settings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.loyalty.settings.useQuery();
  const persisted = settingsQuery.data;

  // Same render-time reset as CompanyDiscountSettingsCard: the rate is a
  // draft until Save, and it re-syncs when the server truth changes.
  const [draftRate, setDraftRate] = useState<number>(1000);
  const [lastPersistedRate, setLastPersistedRate] = useState<number | null>(null);
  const persistedRate = persisted ? toCurrencyPerPoint(persisted.pointsPerUnit) : null;
  if (persistedRate !== null && persistedRate !== lastPersistedRate) {
    setLastPersistedRate(persistedRate);
    setDraftRate(persistedRate);
  }

  const updateMutation = trpc.loyalty.updateSettings.useMutation({
    onSuccess: () => {
      toast.success({ title: t('settings:company.loyalty.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.loyalty.toast.saveError',
    }),
    onSettled: () => utils.loyalty.settings.invalidate(),
  });

  const enabled = persisted?.enabled ?? false;
  const disabled = settingsQuery.isLoading || updateMutation.isPending;
  const rateIsValid = Number.isFinite(draftRate) && draftRate >= MIN_CURRENCY_PER_POINT;
  const rateIsDirty = draftRate !== lastPersistedRate;
  const canSaveRate = rateIsValid && rateIsDirty && !disabled;
  const previewPoints = rateIsValid ? Math.floor(PREVIEW_SALE_TOTAL / draftRate) : 0;

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="pv-title text-lg">{t('settings:company.loyalty.title')}</h2>
          <p className="mt-1 text-sm text-fg3">{t('settings:company.loyalty.description')}</p>
        </div>
      </div>

      <label className="mt-5 flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
          checked={enabled}
          disabled={disabled}
          data-testid="loyalty-enabled-toggle"
          onChange={event => void updateMutation.mutateAsync({ enabled: event.target.checked })}
        />
        <span>
          <span className="text-sm font-medium text-fg">
            {t('settings:company.loyalty.enabledLabel')}
          </span>
          <span className="mt-0.5 block text-[12.5px] text-fg3">
            {t('settings:company.loyalty.enabledHelp')}
          </span>
        </span>
      </label>

      <div className="mt-5">
        <label className="flex flex-col" htmlFor="loyalty-rate">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">
            {t('settings:company.loyalty.rateLabel')}
          </span>
          <span className="mt-0.5 text-[12.5px] text-fg3">
            {t('settings:company.loyalty.rateHelp')}
          </span>
          <input
            id="loyalty-rate"
            type="number"
            min={MIN_CURRENCY_PER_POINT}
            step={100}
            className="input mt-1.5 w-40"
            value={draftRate}
            disabled={disabled}
            aria-invalid={!rateIsValid}
            data-testid="loyalty-rate-input"
            onChange={event => setDraftRate(Number(event.target.value))}
          />
        </label>

        {/* The preview is what makes the rate legible: an admin who has
            never met `pointsPerUnit` can still tell whether the program is
            generous or stingy before committing to it. */}
        <p className="mt-2 text-[12.5px] text-fg3" data-testid="loyalty-rate-preview">
          {rateIsValid
            ? t('settings:company.loyalty.ratePreview', {
                total: formatCurrency(PREVIEW_SALE_TOTAL),
                count: previewPoints,
              })
            : t('settings:company.loyalty.rateInvalid', { min: MIN_CURRENCY_PER_POINT })}
        </p>

        <button
          type="button"
          className="btn-primary mt-3"
          disabled={!canSaveRate}
          data-testid="loyalty-save-rate"
          onClick={() =>
            void updateMutation.mutateAsync({ pointsPerUnit: toPointsPerUnit(draftRate) })
          }
        >
          {t('settings:company.loyalty.save')}
        </button>
      </div>
    </section>
  );
}
