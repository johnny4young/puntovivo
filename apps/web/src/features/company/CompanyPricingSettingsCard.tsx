/**
 * Admin-only card for the tenant pricing mode (H2.1).
 *
 * Reads `companies.getPricingSettings`, writes `updatePriceIncludesTax`,
 * and invalidates on success so the `PricingSync` store snapshot picks up
 * the flip. The switch is an explicit two-option radio + Save (not an
 * instant toggle): it changes how every sale and quotation splits its
 * totals, so an accidental click must not mutate anything.
 */
import { useState } from 'react';
import { Percent } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

export function CompanyPricingSettingsCard() {
  const { t } = useTranslation(['settings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.companies.getPricingSettings.useQuery();
  const persisted = settingsQuery.data?.priceIncludesTax;

  // Draft-resets-to-server-truth via render-time signature comparison —
  // the same React 19 pattern as CompanyDiscountSettingsCard.
  const [draft, setDraft] = useState<boolean>(true);
  const [lastPersisted, setLastPersisted] = useState<string>('');
  const persistedSignature = persisted === undefined ? '' : String(persisted);
  if (persisted !== undefined && persistedSignature !== lastPersisted) {
    setLastPersisted(persistedSignature);
    setDraft(persisted);
  }

  const updateMutation = trpc.companies.updatePriceIncludesTax.useMutation({
    onSuccess: () => {
      toast.success({ title: t('settings:company.pricing.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.pricing.toast.saveError',
    }),
    onSettled: () => utils.companies.getPricingSettings.invalidate(),
  });

  const disabled = settingsQuery.isLoading || updateMutation.isPending;
  const isDirty = persisted !== undefined && draft !== persisted;

  const options = [
    {
      value: true,
      label: t('settings:company.pricing.inclusiveLabel'),
      help: t('settings:company.pricing.inclusiveHelp'),
    },
    {
      value: false,
      label: t('settings:company.pricing.exclusiveLabel'),
      help: t('settings:company.pricing.exclusiveHelp'),
    },
  ];

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <Percent className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="pv-title text-lg">{t('settings:company.pricing.title')}</h2>
          <p className="mt-1 text-sm text-fg3">{t('settings:company.pricing.description')}</p>
        </div>
      </div>

      <fieldset className="mt-5 space-y-3" data-testid="pricing-mode-editor">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">
          {t('settings:company.pricing.legend')}
        </legend>
        {options.map(option => (
          <label
            key={String(option.value)}
            className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm"
          >
            <input
              type="radio"
              name="pricing-mode"
              className="mt-0.5 h-4 w-4 border-secondary-300"
              checked={draft === option.value}
              disabled={disabled}
              onChange={() => setDraft(option.value)}
            />
            <span>
              <span className="block font-medium text-secondary-900">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-fg4">{option.help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={disabled || !isDirty}
          data-testid="pricing-mode-save"
          onClick={() => updateMutation.mutate({ priceIncludesTax: draft })}
        >
          {t('settings:company.pricing.save')}
        </button>
        <p className="text-[11.5px] text-fg4">{t('settings:company.pricing.sessionNote')}</p>
      </div>
    </section>
  );
}
