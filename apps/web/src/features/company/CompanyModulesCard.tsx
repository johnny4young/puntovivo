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
 * Presentation (FASE 7 F5): modules group by surface (Inteligencia ·
 * Superficies de venta · Operación · Integraciones) under a section
 * `.label`, each row is a `.pv-check` with title + muted description +
 * an on/off `.pv-switch` on the right, and the header carries an active
 * count badge. The switch is a real `<button>` (not the proposal's
 * decorative span) so it stays keyboard-operable and AA-compliant.
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

/**
 * Surface groups for the toggle list. Keyed by the module `i18nKey`
 * (the same suffix the server manifest assigns). Modules that ever
 * gain a new i18nKey without a mapping fall back to `integrations`
 * so they still render — the section labels are translated, the
 * grouping itself is presentation-only and carries no gating.
 */
type ModuleSurface = 'intelligence' | 'salesSurfaces' | 'operations' | 'integrations';

const MODULE_SURFACE: Record<string, ModuleSurface> = {
  copilot: 'intelligence',
  anomalyDetection: 'intelligence',
  semanticSearch: 'intelligence',
  posTouch: 'salesSurfaces',
  kds: 'salesSurfaces',
  customerDisplay: 'salesSurfaces',
  mobileWaiter: 'salesSurfaces',
  operationsCenter: 'operations',
  quotations: 'operations',
  delivery: 'operations',
  eventsApi: 'integrations',
};

// Render order of the surface sections (presentation-only).
const SURFACE_ORDER: ModuleSurface[] = [
  'intelligence',
  'salesSurfaces',
  'operations',
  'integrations',
];

// A-30 — vertical presets offered above the toggle list. Ids mirror the
// server's VERTICAL_PRESET_IDS; the patch each applies is server-owned, so
// this array is presentation + the id we send. `icon` is decorative.
const VERTICAL_PRESETS = ['retail', 'restaurant', 'quickservice', 'wholesale'] as const;
type VerticalPresetId = (typeof VERTICAL_PRESETS)[number];

function surfaceOf(item: ModulesListItem): ModuleSurface {
  return MODULE_SURFACE[item.i18nKey] ?? 'integrations';
}

export function CompanyModulesCard() {
  const { t } = useTranslation(['modules', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const listQuery = trpc.modules.list.useQuery();
  // Track in-flight toggles so the UI disables only the row being
  // changed (not every toggle). Keyed on moduleId.
  const [pendingId, setPendingId] = useState<string | null>(null);

  // A-30 — which preset is being applied, so its button shows the spinner
  // and the rest disable. Null when idle.
  const [pendingPreset, setPendingPreset] = useState<VerticalPresetId | null>(null);

  const invalidateModuleReads = () =>
    Promise.all([utils.modules.list.invalidate(), utils.modules.getEffective.invalidate()]);

  const setActive = useCriticalMutation('modules.setActive', {
    onSuccess: async () => {
      // Invalidate BOTH the admin-tab read and the renderer-wide
      // context so route gating + sidebar items pick up the new state
      // on the same tick.
      await invalidateModuleReads();
    },
    onSettled: () => {
      setPendingId(null);
    },
  });

  const applyPreset = useCriticalMutation('modules.applyPreset', {
    onSuccess: async () => {
      await invalidateModuleReads();
    },
    onSettled: () => {
      setPendingPreset(null);
    },
  });

  async function handlePreset(presetId: VerticalPresetId): Promise<void> {
    setPendingPreset(presetId);
    try {
      const result = await applyPreset.mutateAsync({ presetId });
      toast.success({
        title: result.changed
          ? t('modules:presets.applied', { count: result.applied.length })
          : t('modules:presets.noChange'),
      });
    } catch (err) {
      onErrorToast(toast, t, { titleKey: 'modules:presets.error' })(err);
    }
  }

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

  const activeCount = useMemo(() => items.filter(item => item.enabled).length, [items]);

  // Group while preserving the server order within each surface.
  const grouped = useMemo(() => {
    const map = new Map<ModuleSurface, ModulesListItem[]>();
    for (const item of items) {
      const surface = surfaceOf(item);
      const bucket = map.get(surface);
      if (bucket) bucket.push(item);
      else map.set(surface, [item]);
    }
    return SURFACE_ORDER.filter(surface => map.has(surface)).map(surface => ({
      surface,
      modules: map.get(surface) as ModulesListItem[],
    }));
  }, [items]);

  return (
    <section className="card p-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-950">{t('modules:section.title')}</h2>
          <p className="max-w-prose text-sm text-secondary-600">
            {t('modules:section.description')}
          </p>
        </div>
        {!listQuery.isLoading && items.length > 0 && (
          <span className="pv-badge primary shrink-0" data-testid="modules-active-count">
            {t('modules:section.activeCount', { active: activeCount, total: items.length })}
          </span>
        )}
      </header>

      {listQuery.isLoading && (
        <p className="text-sm text-secondary-500">{t('modules:toggle.loading')}</p>
      )}

      {/* A-30 — one-click vertical presets. They shape the sales-surface
          modules for a business type and leave the AI toggles alone, so an
          operator picks "Tienda" and stops seeing KDS without losing a
          copilot key they already configured. */}
      {!listQuery.isLoading && items.length > 0 && (
        <div
          className="rounded-2xl border border-line/70 bg-surface-2/60 p-4"
          data-testid="modules-presets"
        >
          <p className="label">{t('modules:presets.title')}</p>
          <p className="mt-0.5 text-[12.5px] text-secondary-600">
            {t('modules:presets.description')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {VERTICAL_PRESETS.map(presetId => {
              const presetPending = pendingPreset === presetId;
              return (
                <button
                  key={presetId}
                  type="button"
                  className="btn-outline"
                  disabled={pendingPreset !== null}
                  data-testid={`modules-preset-${presetId}`}
                  onClick={() => {
                    void handlePreset(presetId);
                  }}
                >
                  {presetPending
                    ? t('modules:presets.applying')
                    : t(`modules:presets.verticals.${presetId}`)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!listQuery.isLoading &&
        grouped.map(({ surface, modules }) => (
          <div key={surface} className="space-y-1">
            <p className="label">{t(`modules:surfaces.${surface}`)}</p>
            <div>
              {modules.map(item => {
                const labelKey = `modules:items.${item.i18nKey}.label`;
                const descKey = `modules:items.${item.i18nKey}.description`;
                const rowPending = pendingId === item.id;
                const variantKey = item.isExplicit ? 'explicit' : 'default';
                const switchLabel = item.enabled
                  ? t('modules:toggle.disable')
                  : t('modules:toggle.enable');
                return (
                  <div key={item.id} className="pv-check" data-testid={`modules-row-${item.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="t">{t(labelKey)}</span>
                        <span className="pv-badge neutral">
                          {t(`modules:toggle.${variantKey}`)}
                        </span>
                      </div>
                      <p className="d">{t(descKey)}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      aria-label={switchLabel}
                      title={rowPending ? t('modules:toggle.saving') : switchLabel}
                      disabled={rowPending}
                      onClick={() => {
                        void handleToggle(item, !item.enabled);
                      }}
                      className={`pv-switch shrink-0 disabled:cursor-not-allowed disabled:opacity-60${
                        item.enabled ? ' on' : ''
                      }`}
                      data-testid={`modules-toggle-${item.id}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </section>
  );
}
