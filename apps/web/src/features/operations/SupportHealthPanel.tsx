/**
 * ENG-128 — support-facing health summary.
 *
 * This panel composes existing safe read models instead of introducing a
 * second diagnostics backend: module state comes from the renderer cache,
 * device health from the tenant-scoped authority topology, telemetry consent
 * from companies.getCurrent, and desktop version/update state through the
 * existing sandboxed preload bridge.
 *
 * @module features/operations/SupportHealthPanel
 */

import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Activity, AppWindow, Boxes, HeartPulse, MonitorCheck, RadioTower } from 'lucide-react';
import { KpiTile, type KpiTone } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useModulesSnapshot } from '@/features/modules';
import { trpc } from '@/lib/trpc';
import type { SupportUpdateRecoveryState } from './SupportRecoveryChecklist';
import type { SupportAutoUpdateState } from './supportSnapshot';

const SupportReadinessPanels = lazy(async () => {
  const module = await import('./SupportReadinessPanels');
  return { default: module.SupportReadinessPanels };
});

type AutoUpdateState = SupportAutoUpdateState;

interface AutoUpdateStatus {
  state: AutoUpdateState;
  currentVersion: string;
}

const desktopStatusQueryKey = ['operations', 'support-health', 'desktop-status'] as const;

function updateTone(state: AutoUpdateState): KpiTone {
  if (state === 'error') return 'danger';
  if (state === 'available' || state === 'downloaded') return 'warning';
  if (state === 'idle') return 'success';
  return 'ink';
}

function isUpdateAttentionState(state: AutoUpdateState): boolean {
  return state === 'error' || state === 'available' || state === 'downloaded';
}

function recoveryUpdateState(
  isDesktop: boolean,
  state: AutoUpdateState
): SupportUpdateRecoveryState {
  if (!isDesktop) return 'desktopOnly';
  if (state === 'idle') return 'healthy';
  if (state === 'checking') return 'checking';
  return 'attention';
}

export function SupportHealthPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const navigate = useNavigate();
  const modulesSnapshot = useModulesSnapshot();
  const authorityQuery = trpc.authority.status.useQuery(undefined, {
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electron);
  const desktopQuery = useQuery({
    queryKey: desktopStatusQueryKey,
    queryFn: async (): Promise<AutoUpdateStatus> => {
      if (!window.electron) {
        return { state: 'unavailable', currentVersion: '' };
      }
      const status = await window.electron.getAutoUpdateStatus();
      return { state: status.state, currentVersion: status.currentVersion };
    },
    enabled: isDesktop,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const moduleEntries = Object.entries(modulesSnapshot.modules);
  const activeModuleCount = moduleEntries.filter(([, active]) => active).length;
  const devices = authorityQuery.data?.devices ?? [];
  const activeDevices = devices.filter(device => device.healthStatus !== 'revoked');
  const onlineDevices = activeDevices.filter(device => device.healthStatus === 'online').length;
  const staleDevices = activeDevices.length - onlineDevices;
  const telemetryEnabled = companyQuery.data?.telemetryOptIn === true;
  const desktopStatus = desktopQuery.data;
  const updateState: AutoUpdateState = isDesktop
    ? (desktopStatus?.state ?? 'checking')
    : 'unavailable';
  const needsAttention = staleDevices + (isDesktop && isUpdateAttentionState(updateState) ? 1 : 0);
  const isLoading =
    modulesSnapshot.isLoading ||
    authorityQuery.isLoading ||
    companyQuery.isLoading ||
    (isDesktop && desktopQuery.isLoading);
  const hasError = Boolean(authorityQuery.error || companyQuery.error || desktopQuery.error);

  const runtimeValue = isDesktop
    ? desktopStatus?.currentVersion || t('support.health.runtime.unknownVersion')
    : t('support.health.runtime.web');
  const deviceContext =
    activeDevices.length === 0
      ? t('support.health.devices.none')
      : staleDevices > 0
        ? t('support.health.devices.stale', { count: staleDevices })
        : t('support.health.devices.clear');

  return (
    <div className="space-y-6" data-testid="support-health-panel">
      <section className="card overflow-hidden">
        <div className="border-b border-line bg-[linear-gradient(120deg,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_55%)] p-6">
          <header className="flex items-start gap-3">
            <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
              <HeartPulse className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="pv-kicker">{t('support.kicker')}</p>
              <h2 className="pv-title text-xl">{t('support.health.title')}</h2>
              <p className="mt-1 max-w-3xl text-sm text-fg3">{t('support.health.description')}</p>
            </div>
          </header>
        </div>

        <div className="space-y-5 p-6">
          {isLoading && <p className="text-sm text-fg3">{t('common.loading')}</p>}

          {hasError && (
            <div className="pv-strip danger" role="alert">
              <Activity className="h-4 w-4" aria-hidden="true" />
              <span>{t('support.health.loadError')}</span>
            </div>
          )}

          {!isLoading && !hasError && (
            <div
              className={`pv-strip ${needsAttention > 0 ? 'warning' : 'success'}`}
              data-testid="support-health-summary"
              role="status"
            >
              <MonitorCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                {needsAttention > 0
                  ? t('support.health.summary.attention', { count: needsAttention })
                  : t('support.health.summary.clear')}
              </span>
            </div>
          )}

          <div className="pv-kpis grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
            <KpiTile
              icon={AppWindow}
              tone="primary"
              mono
              label={t('support.health.runtime.label')}
              value={runtimeValue}
              context={
                isDesktop
                  ? t('support.health.runtime.desktop')
                  : t('support.health.runtime.webContext')
              }
            />
            <KpiTile
              icon={Activity}
              tone={updateTone(updateState)}
              label={t('support.health.updates.label')}
              value={t(`support.health.updates.state.${updateState}`)}
              context={
                isDesktop
                  ? t('support.health.updates.desktopContext')
                  : t('support.health.updates.webContext')
              }
            />
            <KpiTile
              icon={Boxes}
              tone={modulesSnapshot.isPlaceholder ? 'warning' : 'success'}
              label={t('support.health.modules.label')}
              value={t('support.health.modules.value', {
                active: activeModuleCount,
                total: moduleEntries.length,
              })}
              context={
                modulesSnapshot.isPlaceholder
                  ? t('support.health.modules.loading')
                  : t('support.health.modules.context')
              }
            />
            <KpiTile
              icon={RadioTower}
              tone={staleDevices > 0 ? 'warning' : 'success'}
              label={t('support.health.devices.label')}
              value={t('support.health.devices.value', {
                online: onlineDevices,
                total: activeDevices.length,
              })}
              context={deviceContext}
            />
            <KpiTile
              icon={HeartPulse}
              tone={telemetryEnabled ? 'success' : 'ink'}
              label={t('support.health.telemetry.label')}
              value={
                telemetryEnabled
                  ? t('support.health.telemetry.enabled')
                  : t('support.health.telemetry.disabled')
              }
              context={t('support.health.telemetry.context')}
            />
          </div>
        </div>
      </section>

      <Suspense fallback={<p className="text-sm text-fg3">{t('common.loading')}</p>}>
        <SupportReadinessPanels
          isAdmin={user?.role === 'admin'}
          updateState={recoveryUpdateState(isDesktop, updateState)}
          staleDeviceCount={staleDevices}
          telemetryEnabled={telemetryEnabled}
          hasSignalError={hasError}
          onNavigate={navigate}
          snapshotData={[
            isDesktop ? 'desktop' : 'web',
            desktopStatus?.currentVersion || null,
            updateState,
            modulesSnapshot.modules,
            devices,
            telemetryEnabled,
            isLoading || hasError || modulesSnapshot.isPlaceholder,
          ]}
        />
      </Suspense>
    </div>
  );
}
