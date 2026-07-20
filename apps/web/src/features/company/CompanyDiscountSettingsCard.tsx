/**
 * Admin-only card for the tenant's expiry-discount ladder.
 *
 * Sits inside `CompanyPage`'s "general" tab next to the cash-close card.
 * Reads `discountSettings.get`, writes via `discountSettings.update`, and
 * invalidates on success so admins see the persisted ladder immediately.
 *
 * The ladder drives the  expiry radar: a lot expiring within
 * `maxDays` earns `pct`, first match wins. The editor is deliberately a
 * small fixed list of rows (add/remove/edit) rather than a free-form JSON
 * box — pricing policy is owner territory, but it should not require
 * knowing our storage shape. The server re-sorts, de-duplicates, and
 * re-validates whatever arrives, so a mis-ordered edit is impossible to
 * persist.
 *
 * Note: like the cash-close flag, the value that drives the radar's row
 * preview flows through the `auth.me` session payload, so a change lands
 * on the next login / refresh for other users.
 */
import { useState } from 'react';
import { BadgePercent, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

/** Mirrors the server bounds (services/discount-settings). */
const MAX_TIERS = 5;
const MAX_DAYS_LIMIT = 365;

interface TierDraft {
  maxDays: number;
  pct: number;
}

function isIntegerWithin(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function nextTierMaxDays(rows: TierDraft[]): number {
  const used = new Set(
    rows.map(row => row.maxDays).filter(value => isIntegerWithin(value, 1, MAX_DAYS_LIMIT))
  );
  const largest = Math.max(0, ...used);
  const preferred = Math.min(largest + 15, MAX_DAYS_LIMIT);

  // Stay near the current largest threshold without ever generating the
  // out-of-range 380-day row that a 365-day last tier used to produce.
  for (let candidate = preferred; candidate >= 1; candidate -= 1) {
    if (!used.has(candidate)) return candidate;
  }
  for (let candidate = preferred + 1; candidate <= MAX_DAYS_LIMIT; candidate += 1) {
    if (!used.has(candidate)) return candidate;
  }
  return 1;
}

export function CompanyDiscountSettingsCard() {
  const { t } = useTranslation(['settings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.discountSettings.get.useQuery();
  const persisted = settingsQuery.data?.expiryTiers;

  // Local draft so the operator can edit several rows before saving. When
  // the server truth changes (first load, refetch after save) the draft
  // resets to it. `lastPersisted` is the companion signature that detects
  // that change during render and queues a same-render setState — the
  // React 19 pattern the repo already uses in ProductSearchDialog, which
  // avoids both a useEffect cascade and the lint that forbids setState
  // inside an effect.
  const [draft, setDraft] = useState<TierDraft[]>([]);
  const [lastPersisted, setLastPersisted] = useState<string>('');
  const persistedSignature = persisted ? JSON.stringify(persisted) : '';
  if (persisted && persistedSignature !== lastPersisted) {
    setLastPersisted(persistedSignature);
    setDraft(persisted.map(tier => ({ ...tier })));
  }

  const updateMutation = trpc.discountSettings.update.useMutation({
    onSuccess: () => {
      toast.success({ title: t('settings:company.discount.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.discount.toast.saveError',
    }),
    onSettled: () => utils.discountSettings.get.invalidate(),
  });

  const disabled = settingsQuery.isLoading || updateMutation.isPending;
  const isDirty = JSON.stringify(draft) !== lastPersisted;
  const dayCounts = new Map<number, number>();
  for (const tier of draft) {
    dayCounts.set(tier.maxDays, (dayCounts.get(tier.maxDays) ?? 0) + 1);
  }
  const isDraftValid = draft.every(
    tier =>
      isIntegerWithin(tier.maxDays, 1, MAX_DAYS_LIMIT) &&
      dayCounts.get(tier.maxDays) === 1 &&
      isIntegerWithin(tier.pct, 1, 99)
  );
  const canSave = draft.length > 0 && isDirty && isDraftValid && !disabled;

  const setRow = (index: number, patch: Partial<TierDraft>) => {
    setDraft(rows => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <BadgePercent className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="pv-title text-lg">{t('settings:company.discount.title')}</h2>
          <p className="mt-1 text-sm text-fg3">{t('settings:company.discount.description')}</p>
        </div>
      </div>

      <div className="mt-5 space-y-2" data-testid="discount-tiers-editor">
        {draft.map((tier, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">
                {t('settings:company.discount.maxDaysLabel')}
              </span>
              <input
                type="number"
                min={1}
                max={MAX_DAYS_LIMIT}
                className="input mt-1 w-24"
                value={tier.maxDays}
                disabled={disabled}
                aria-invalid={
                  !isIntegerWithin(tier.maxDays, 1, MAX_DAYS_LIMIT) ||
                  dayCounts.get(tier.maxDays) !== 1
                }
                aria-label={t('settings:company.discount.maxDaysAria', { position: index + 1 })}
                onChange={event => setRow(index, { maxDays: Number(event.target.value) })}
              />
            </label>
            <label className="flex flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">
                {t('settings:company.discount.pctLabel')}
              </span>
              <input
                type="number"
                min={1}
                max={99}
                className="input mt-1 w-24"
                value={tier.pct}
                disabled={disabled}
                aria-invalid={!isIntegerWithin(tier.pct, 1, 99)}
                aria-label={t('settings:company.discount.pctAria', { position: index + 1 })}
                onChange={event => setRow(index, { pct: Number(event.target.value) })}
              />
            </label>
            <button
              type="button"
              className="btn-outline btn-icon mb-0.5"
              disabled={disabled || draft.length <= 1}
              aria-label={t('settings:company.discount.removeTier', { position: index + 1 })}
              onClick={() => setDraft(rows => rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="btn-outline"
            disabled={disabled || draft.length >= MAX_TIERS}
            data-testid="discount-add-tier"
            onClick={() => setDraft(rows => [...rows, { maxDays: nextTierMaxDays(rows), pct: 10 }])}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('settings:company.discount.addTier')}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!canSave}
            data-testid="discount-save-tiers"
            onClick={() => void updateMutation.mutateAsync({ expiryTiers: draft })}
          >
            {t('settings:company.discount.save')}
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-fg4">{t('settings:company.discount.sessionNote')}</p>
      </div>
    </section>
  );
}
