/**
 * ENG-068 — Admin-only card for module activation.
 *
 * Sits inside `CompanyPage`'s admin grid under the `Modules` tab.
 * Reads `modules.list` to discover the current state per module + the
 * default-vs-explicit flag, writes via `modules.setActive` (a critical
 * mutation — needs the device id + envelope), and surfaces a translated
 * label + description for each toggle.
 *
 * The optimistic-update path: on toggle, the card invalidates
 * `modules.list` AND `modules.getEffective` so both the admin tab and
 * the renderer-wide context refetch in lockstep. Sidebar entries +
 * gated routes therefore reflect the new state on the same tick the
 * toast lands.
 *
 * Manager + cashier never reach here (the `modules` tab is admin-only
 * in `CompanyPage`); the role guard on `modules.setActive` is the
 * server-side belt + braces.
 *
 * @module features/company/CompanyModulesCard
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { ClientModuleId } from '@/features/modules';

interface ModulesListItem {
  id: string;
  i18nKey: string;
  adminVisibilityRole: string;
  defaultEnabled: boolean;
  enabled: boolean;
  isExplicit: boolean;
}

export function CompanyModulesCard() {
  const { t } = useTranslation(['modules', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const listQuery = trpc.modules.list.useQuery();
  // Track in-flight toggles so the UI disables only the row being
  // changed (not every toggle). Keyed on moduleId.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const setActive = useCriticalMutation('modules.setActive', {
    onSuccess: async () => {
      // Invalidate BOTH the admin-tab read and the renderer-wide
      // context so route gating + sidebar items pick up the new state
      // on the same tick.
      await Promise.all([
        utils.modules.list.invalidate(),
        utils.modules.getEffective.invalidate(),
      ]);
    },
    onSettled: () => {
      setPendingId(null);
    },
  });

  async function handleToggle(item: ModulesListItem, nextEnabled: boolean): Promise<void> {
    setPendingId(item.id);
    try {
      await setActive.mutateAsync({
        moduleId: item.id as ClientModuleId,
        enabled: nextEnabled,
      });
      toast.success({
        title: nextEnabled
          ? t('modules:toggle.successEnabled')
          : t('modules:toggle.successDisabled'),
      });
    } catch (err) {
      onErrorToast(toast, t, { titleKey: 'modules:toggle.error' })(err);
    }
  }

  const items = useMemo<ModulesListItem[]>(
    () => (listQuery.data?.modules ?? []) as ModulesListItem[],
    [listQuery.data?.modules]
  );

  return (
    <section className="card p-6 space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-secondary-950">
          {t('modules:section.title')}
        </h2>
        <p className="text-sm text-secondary-600">
          {t('modules:section.description')}
        </p>
      </header>

      {listQuery.isLoading && (
        <p className="text-sm text-secondary-500">{t('modules:toggle.loading')}</p>
      )}

      {!listQuery.isLoading && items.length > 0 && (
        <ul className="divide-y divide-line/60">
          {items.map(item => {
            const labelKey = `modules:items.${item.i18nKey}.label`;
            const descKey = `modules:items.${item.i18nKey}.description`;
            const rowPending = pendingId === item.id;
            const variantKey = item.isExplicit ? 'explicit' : 'default';
            return (
              <li
                key={item.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`modules-row-${item.id}`}
              >
                <div className="space-y-1">
                  <p className="font-medium text-secondary-900">{t(labelKey)}</p>
                  <p className="text-sm text-secondary-600">{t(descKey)}</p>
                  <p className="text-xs uppercase tracking-wider text-secondary-500">
                    {t(`modules:toggle.${variantKey}`)}
                  </p>
                </div>
                <label className="inline-flex shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={item.enabled}
                    disabled={rowPending}
                    onChange={event => {
                      void handleToggle(item, event.target.checked);
                    }}
                    aria-label={
                      item.enabled
                        ? t('modules:toggle.disable')
                        : t('modules:toggle.enable')
                    }
                    data-testid={`modules-toggle-${item.id}`}
                  />
                  <span className="text-sm text-secondary-700">
                    {rowPending
                      ? t('modules:toggle.saving')
                      : item.enabled
                        ? t('modules:toggle.disable')
                        : t('modules:toggle.enable')}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
