import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  Ban,
  Copy,
  KeyRound,
  MonitorCog,
  Network,
  RefreshCw,
  Cpu,
  DatabaseZap,
  Radio,
  Hourglass,
} from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { cn, formatDateTime } from '@/lib/utils';
import { EmptyState } from '@/components/feedback/EmptyState';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';
import { Badge, KpiTile, Button } from '@/components/ui';

/**
 * Operations Center: Authority Health panel.
 *
 * hereda las recetas pv-*: titulación de panel,
 * KPI con la receta única para la topología (códigos pendientes en
 * danger cuando hay > 0), formulario con .pv-field / .pv-input / Button,
 * tabla densa (.pv-table) con badge semántico de salud, y estado vacío
 * del sistema (EmptyState).
 */

type AuthorityStatus = inferRouterOutputs<AppRouter>['authority']['status'];
type AuthorityDevice = AuthorityStatus['devices'][number];
function healthBadgeTone(
  status: AuthorityDevice['healthStatus']
): 'success' | 'warning' | 'danger' {
  if (status === 'online') return 'success';
  if (status === 'stale') return 'warning';
  return 'danger';
}
function roleLabelKey(role: AuthorityDevice['authorityRole']): string {
  return `authority.roles.${role}`;
}
export function AuthorityHealthPanel() {
  const { t } = useTranslation('operations');
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const utils = trpc.useUtils();
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [expiresInMinutes, setExpiresInMinutes] = useState(10);
  const [latestCode, setLatestCode] = useState<{
    code: string;
    expiresAt: string;
    siteId: string;
  } | null>(null);
  const statusQuery = trpc.authority.status.useQuery(undefined, {
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const sitesQuery = trpc.sites.list.useQuery();
  const sites = sitesQuery.data?.items ?? [];
  const activeSiteId = selectedSiteId || sites[0]?.id || '';
  const createMutation = trpc.authority.createPairingCode.useMutation({
    onSuccess: async result => {
      setLatestCode({
        code: result.code,
        expiresAt: result.expiresAt,
        siteId: result.siteId,
      });
      await utils.authority.status.invalidate();
      toast.success({
        title: t('authority.pairing.created'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:authority.pairing.error',
    }),
  });
  const revokeMutation = trpc.authority.revokeDevice.useMutation({
    onSuccess: async () => {
      await utils.authority.status.invalidate();
      toast.success({
        title: t('authority.devices.revokeSuccess'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:authority.devices.revokeError',
    }),
  });
  const topology = statusQuery.data;
  const devices = topology?.devices ?? [];
  const pendingCodes = topology?.pairingCodes.filter(code => code.status === 'pending') ?? [];
  const {
    pageRows: devicePageRows,
    hasPagination: devicesHavePagination,
    ...devicesPagination
  } = usePaginatedRows(devices, 8);
  async function copyLatestCode(): Promise<void> {
    if (!latestCode) return;
    await navigator.clipboard?.writeText(latestCode.code);
    toast.success({
      title: t('authority.pairing.copied'),
    });
  }
  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6">
        <header className="flex items-start gap-3">
          <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
            <Network className="h-5 w-5" />
          </span>
          <div>
            <p className="pv-kicker">{t('authority.kicker')}</p>
            <h2 className="pv-title text-lg">{t('authority.hub.title')}</h2>
            <p className="mt-1 text-sm text-secondary-500">{t('authority.hub.description')}</p>
          </div>
        </header>

        {statusQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('common.loading')}</p>
        )}

        {statusQuery.error && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {translateServerError(statusQuery.error, t, t('common.errorGeneric'))}
          </div>
        )}

        {topology && (
          <div className="pv-kpis grid-cols-2 xl:grid-cols-4">
            <KpiTile
              icon={Radio}
              tone="primary"
              label={t('authority.hub.mode')}
              value={t(`authority.modes.${topology.runtime.authorityMode}`)}
            />
            <KpiTile
              icon={DatabaseZap}
              tone="ink"
              mono
              label={t('authority.hub.schema')}
              value={String(topology.hub.dbSchemaVersion ?? '—')}
            />
            <KpiTile
              icon={Cpu}
              tone="primary"
              label={t('authority.hub.activeDevices')}
              value={String(topology.hub.tenantActiveDeviceCount)}
            />
            <KpiTile
              icon={Hourglass}
              tone={pendingCodes.length > 0 ? 'warning' : 'ink'}
              label={t('authority.hub.pendingCodes')}
              value={String(pendingCodes.length)}
            />
          </div>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <header className="flex items-start gap-3">
          <span className="pv-gt pv-gt-warning h-11 w-11 rounded-xl">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <p className="pv-kicker">{t('authority.kicker')}</p>
            <h2 className="pv-title text-lg">{t('authority.pairing.title')}</h2>
            <p className="mt-1 text-sm text-secondary-500">{t('authority.pairing.description')}</p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
          <label className="pv-field">
            <span className="label">{t('authority.pairing.site')}</span>
            <select
              className="pv-input"
              value={activeSiteId}
              onChange={event => setSelectedSiteId(event.target.value)}
              disabled={!isAdmin || sites.length === 0}
              data-testid="authority-pairing-site"
            >
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="pv-field">
            <span className="label">{t('authority.pairing.deviceName')}</span>
            <input
              className="pv-input"
              value={deviceName}
              onChange={event => setDeviceName(event.target.value)}
              disabled={!isAdmin}
              maxLength={120}
              data-testid="authority-pairing-device-name"
            />
          </label>
          <label className="pv-field">
            <span className="label">{t('authority.pairing.ttl')}</span>
            <input
              className="pv-input"
              type="number"
              min={1}
              max={60}
              value={expiresInMinutes}
              onChange={event => setExpiresInMinutes(Number(event.target.value))}
              disabled={!isAdmin}
              data-testid="authority-pairing-ttl"
            />
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              className="w-full"
              disabled={!isAdmin || !activeSiteId || createMutation.isPending}
              title={!isAdmin ? t('authority.pairing.noPermission') : undefined}
              onClick={() =>
                createMutation.mutate({
                  siteId: activeSiteId,
                  deviceName: deviceName.trim() || undefined,
                  expiresInMinutes,
                })
              }
              data-testid="authority-create-pairing-code"
              variant="primary"
            >
              <KeyRound />
              {t('authority.pairing.cta')}
            </Button>
          </div>
        </div>

        {latestCode && (
          <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="pv-kicker text-primary-800">{t('authority.pairing.latest')}</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-primary-900">
                  {latestCode.code}
                </p>
                <p className="text-sm text-primary-800">
                  {t('authority.pairing.expiresAt', {
                    value: formatDateTime(latestCode.expiresAt),
                  })}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void copyLatestCode()}
                data-testid="authority-copy-pairing-code"
                variant="outline"
              >
                <Copy />
                {t('authority.pairing.copy')}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="card space-y-4 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="pv-gt pv-gt-ink h-11 w-11 rounded-xl">
              <MonitorCog className="h-5 w-5" />
            </span>
            <div>
              <p className="pv-kicker">{t('authority.kicker')}</p>
              <h2 className="pv-title text-lg">{t('authority.devices.title')}</h2>
              <p className="mt-1 text-sm text-secondary-500">
                {t('authority.devices.description')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => void statusQuery.refetch()}
            data-testid="authority-refresh"
            variant="ghost"
          >
            <RefreshCw className={cn(statusQuery.isFetching && 'animate-spin')} />
            {t('authority.devices.refresh')}
          </Button>
        </header>

        {devices.length === 0 && !statusQuery.isLoading && (
          <EmptyState
            icon={MonitorCog}
            title={t('authority.devices.title')}
            description={t('authority.devices.empty')}
          />
        )}

        {devices.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-line/75">
            <table className="pv-table">
              <thead>
                <tr>
                  <th>{t('authority.devices.columns.name')}</th>
                  <th>{t('authority.devices.columns.role')}</th>
                  <th>{t('authority.devices.columns.site')}</th>
                  <th>{t('authority.devices.columns.health')}</th>
                  <th>{t('authority.devices.columns.lastSeen')}</th>
                  <th>{t('authority.devices.columns.version')}</th>
                  <th className="num">{t('authority.devices.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {devicePageRows.map(device => {
                  const canRevoke =
                    isAdmin &&
                    device.authorityRole === 'hub_client' &&
                    device.healthStatus !== 'revoked';
                  const isRevoking =
                    revokeMutation.isPending && revokeMutation.variables?.deviceId === device.id;
                  return (
                    <tr key={device.id}>
                      <td className="font-medium text-secondary-900">{device.name}</td>
                      <td className="muted">{t(roleLabelKey(device.authorityRole))}</td>
                      <td className="muted">{device.pairedSiteName ?? '—'}</td>
                      <td>
                        <Badge variant={healthBadgeTone(device.healthStatus)} marker="dot">
                          {t(`authority.health.${device.healthStatus}`)}
                        </Badge>
                      </td>
                      <td className="muted whitespace-nowrap">
                        {device.lastSeenAt ? formatDateTime(device.lastSeenAt) : '—'}
                      </td>
                      <td className="muted">{device.appVersion ?? '—'}</td>
                      <td className="num">
                        {device.authorityRole === 'hub_client' && (
                          <Button
                            type="button"
                            className="ml-auto"
                            disabled={!canRevoke || isRevoking}
                            title={!isAdmin ? t('authority.devices.noPermission') : undefined}
                            onClick={() => {
                              if (
                                !canRevoke ||
                                !window.confirm(
                                  t('authority.devices.confirmRevoke', {
                                    name: device.name,
                                  })
                                )
                              ) {
                                return;
                              }
                              revokeMutation.mutate({
                                deviceId: device.id,
                              });
                            }}
                            data-testid={`authority-revoke-${device.id}`}
                            variant="ghost"
                          >
                            <Ban className={cn(isRevoking && 'animate-spin')} />
                            {t('authority.devices.revoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {devicesHavePagination && (
          <TablePagination {...devicesPagination} onPageChange={devicesPagination.setPage} />
        )}
      </section>
    </div>
  );
}
