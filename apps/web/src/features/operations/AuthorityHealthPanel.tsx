import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Ban, Copy, KeyRound, MonitorCog, Network, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { cn, formatDateTime } from '@/lib/utils';

type AuthorityStatus = inferRouterOutputs<AppRouter>['authority']['status'];
type AuthorityDevice = AuthorityStatus['devices'][number];

function healthBadgeVariant(status: AuthorityDevice['healthStatus']) {
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
      toast.success({ title: t('authority.pairing.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'operations:authority.pairing.error' }),
  });

  const revokeMutation = trpc.authority.revokeDevice.useMutation({
    onSuccess: async () => {
      await utils.authority.status.invalidate();
      toast.success({ title: t('authority.devices.revokeSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'operations:authority.devices.revokeError' }),
  });

  const topology = statusQuery.data;
  const devices = topology?.devices ?? [];
  const pendingCodes = topology?.pairingCodes.filter(code => code.status === 'pending') ?? [];

  async function copyLatestCode(): Promise<void> {
    if (!latestCode) return;
    await navigator.clipboard?.writeText(latestCode.code);
    toast.success({ title: t('authority.pairing.copied') });
  }

  return (
    <div className="space-y-6">
      <section className="card p-6 space-y-4">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
            <Network className="h-5 w-5 text-primary-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('authority.hub.title')}
            </h2>
            <p className="text-sm text-secondary-500">
              {t('authority.hub.description')}
            </p>
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              label={t('authority.hub.mode')}
              value={t(`authority.modes.${topology.runtime.authorityMode}`)}
            />
            <SummaryTile
              label={t('authority.hub.schema')}
              value={String(topology.hub.dbSchemaVersion ?? '—')}
            />
            <SummaryTile
              label={t('authority.hub.activeDevices')}
              value={String(topology.hub.tenantActiveDeviceCount)}
            />
            <SummaryTile
              label={t('authority.hub.pendingCodes')}
              value={String(pendingCodes.length)}
            />
          </div>
        )}
      </section>

      <section className="card p-6 space-y-4">
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-warning-100">
            <KeyRound className="h-5 w-5 text-warning-700" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('authority.pairing.title')}
            </h2>
            <p className="text-sm text-secondary-500">
              {t('authority.pairing.description')}
            </p>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]">
          <label className="space-y-1 text-sm font-medium text-secondary-700">
            <span>{t('authority.pairing.site')}</span>
            <select
              className="input"
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
          <label className="space-y-1 text-sm font-medium text-secondary-700">
            <span>{t('authority.pairing.deviceName')}</span>
            <input
              className="input"
              value={deviceName}
              onChange={event => setDeviceName(event.target.value)}
              disabled={!isAdmin}
              maxLength={120}
              data-testid="authority-pairing-device-name"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-secondary-700">
            <span>{t('authority.pairing.ttl')}</span>
            <input
              className="input"
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
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
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
            >
              <KeyRound className="h-4 w-4" />
              {t('authority.pairing.cta')}
            </button>
          </div>
        </div>

        {latestCode && (
          <div className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                  {t('authority.pairing.latest')}
                </p>
                <p className="font-mono text-2xl font-semibold text-primary-900">
                  {latestCode.code}
                </p>
                <p className="text-sm text-primary-800">
                  {t('authority.pairing.expiresAt', {
                    value: formatDateTime(latestCode.expiresAt),
                  })}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => void copyLatestCode()}
                data-testid="authority-copy-pairing-code"
              >
                <Copy className="h-4 w-4" />
                {t('authority.pairing.copy')}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-6 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-100">
              <MonitorCog className="h-5 w-5 text-secondary-700" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-secondary-900">
                {t('authority.devices.title')}
              </h2>
              <p className="text-sm text-secondary-500">
                {t('authority.devices.description')}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            onClick={() => void statusQuery.refetch()}
            data-testid="authority-refresh"
          >
            <RefreshCw
              className={cn('h-4 w-4', statusQuery.isFetching && 'animate-spin')}
            />
            {t('authority.devices.refresh')}
          </button>
        </header>

        {devices.length === 0 && !statusQuery.isLoading && (
          <p className="text-sm text-secondary-500">{t('authority.devices.empty')}</p>
        )}

        {devices.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('authority.devices.columns.name')}</th>
                  <th className="px-3 py-2">{t('authority.devices.columns.role')}</th>
                  <th className="px-3 py-2">{t('authority.devices.columns.site')}</th>
                  <th className="px-3 py-2">{t('authority.devices.columns.health')}</th>
                  <th className="px-3 py-2">{t('authority.devices.columns.lastSeen')}</th>
                  <th className="px-3 py-2">{t('authority.devices.columns.version')}</th>
                  <th className="px-3 py-2 text-right">{t('authority.devices.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(device => {
                  const canRevoke =
                    isAdmin &&
                    device.authorityRole === 'hub_client' &&
                    device.healthStatus !== 'revoked';
                  const isRevoking =
                    revokeMutation.isPending &&
                    revokeMutation.variables?.deviceId === device.id;
                  return (
                    <tr key={device.id} className="border-t border-secondary-200">
                      <td className="px-3 py-2 text-secondary-900">{device.name}</td>
                      <td className="px-3 py-2 text-secondary-700">
                        {t(roleLabelKey(device.authorityRole))}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {device.pairedSiteName ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={healthBadgeVariant(device.healthStatus)}>
                          {t(`authority.health.${device.healthStatus}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {device.lastSeenAt ? formatDateTime(device.lastSeenAt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-secondary-700">
                        {device.appVersion ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {device.authorityRole === 'hub_client' && (
                          <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-2 text-sm"
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
                              revokeMutation.mutate({ deviceId: device.id });
                            }}
                            data-testid={`authority-revoke-${device.id}`}
                          >
                            <Ban
                              className={cn('h-4 w-4', isRevoking && 'animate-spin')}
                            />
                            {t('authority.devices.revoke')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-secondary-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-secondary-900">{value}</p>
    </div>
  );
}
