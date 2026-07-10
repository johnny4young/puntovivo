/**
 * ENG-194b — Admin-only card for the tenant's cash-close policy.
 *
 * Sits inside `CompanyPage`'s "general" tab. Reads `cashCloseSettings.get`,
 * writes via `cashCloseSettings.update`, and invalidates the query on
 * success so admins see the persisted value immediately.
 *
 * v1 surfaces a single switch — blind close (default ON). ON keeps the
 * anti-fraud discipline: cashiers count the till without seeing the
 * expected balance and only managers/admins get the live over/short
 * semaphore. OFF shows the live semaphore to every role (owner-operated
 * shops that prefer speed over the control).
 *
 * Note: like the restaurant service-charge rate, the value that drives the
 * POS modal flows through the `auth.me` session payload (cached on login).
 * Cashiers see the change on their next login; admins refresh the page.
 */
import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

export function CompanyCashCloseSettingsCard() {
  const { t } = useTranslation(['settings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.cashCloseSettings.get.useQuery();
  const blindClose = settingsQuery.data?.blindClose ?? true;

  const updateMutation = trpc.cashCloseSettings.update.useMutation({
    onSuccess: async () => {
      await utils.cashCloseSettings.get.invalidate();
      toast.success({ title: t('settings:company.cashClose.toast.saved') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:company.cashClose.toast.saveError',
    }),
  });

  const disabled = settingsQuery.isLoading || updateMutation.isPending;

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
          <EyeOff className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="pv-title text-lg">{t('settings:company.cashClose.title')}</h2>
          <p className="mt-1 text-sm text-fg3">{t('settings:company.cashClose.description')}</p>
        </div>
      </div>

      <div className="mt-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--primary)]"
            checked={blindClose}
            disabled={disabled}
            data-testid="cash-close-blind-toggle"
            onChange={event =>
              void updateMutation.mutateAsync({ blindClose: event.target.checked })
            }
          />
          <span>
            <span className="block text-sm font-medium text-fg1">
              {t('settings:company.cashClose.blindLabel')}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-fg3">
              {blindClose
                ? t('settings:company.cashClose.blindOnHint')
                : t('settings:company.cashClose.blindOffHint')}
            </span>
          </span>
        </label>
        <p className="mt-3 text-[11.5px] text-fg4">{t('settings:company.cashClose.sessionNote')}</p>
      </div>
    </section>
  );
}
