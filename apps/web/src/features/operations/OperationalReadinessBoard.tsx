import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CloudCog,
  CreditCard,
  FileCheck2,
  Landmark,
  Printer,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  OPERATIONAL_READINESS_CONTRACT,
  OPERATIONAL_READINESS_SERVICES,
  type OperationalServiceId,
} from '@puntovivo/shared/operational-readiness';
import { Badge, Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import type { BadgeVariant } from '@/components/ui/Badge';
import type { NeedsAttentionArea } from './NeedsAttentionPanel';
import {
  evaluateBackupSignal,
  evaluateServerSignal,
  evaluateUpdateSignal,
  type OperationalSignal,
  type OperationalSignalStatus,
} from './operationalReadiness';

interface OperationalReadinessBoardProps {
  onReviewArea: (area: NeedsAttentionArea) => void;
  onNavigate: (target: string) => void;
}

const SERVICE_ICONS: Record<OperationalServiceId, LucideIcon> = {
  sync: RefreshCw,
  fiscal: Landmark,
  device: Printer,
  payments: CreditCard,
  backup: CloudCog,
  updates: FileCheck2,
};

const STATUS_VARIANTS: Record<OperationalSignalStatus, BadgeVariant> = {
  healthy: 'success',
  watch: 'warning',
  action_required: 'danger',
  unavailable: 'neutral',
};

const SERVER_SERVICE_IDS = ['sync', 'fiscal', 'device', 'payments'] as const;

function isServerService(id: OperationalServiceId): id is (typeof SERVER_SERVICE_IDS)[number] {
  return (SERVER_SERVICE_IDS as readonly string[]).includes(id);
}

export function OperationalReadinessBoard({
  onReviewArea,
  onNavigate,
}: OperationalReadinessBoardProps) {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const attentionQuery = trpc.operations.needsAttention.useQuery(undefined, {
    staleTime: 15_000,
    refetchInterval: 15_000,
  });
  const backupQuery = useQuery({
    queryKey: ['operational-readiness', 'backup-schedule'],
    queryFn: async () => {
      if (!electron?.getBackupScheduleStatus) throw new Error('desktop_required');
      return electron.getBackupScheduleStatus();
    },
    enabled: Boolean(isAdmin && electron?.getBackupScheduleStatus),
    staleTime: 60_000,
  });
  const updateQuery = useQuery({
    queryKey: ['operational-readiness', 'updates'],
    queryFn: async () => {
      if (!electron?.getAutoUpdateStatus) throw new Error('desktop_required');
      return electron.getAutoUpdateStatus();
    },
    enabled: Boolean(electron?.getAutoUpdateStatus),
    staleTime: 60_000,
  });

  const queryState = attentionQuery.isLoading
    ? 'loading'
    : attentionQuery.isError
      ? 'error'
      : 'ready';

  const signals = Object.fromEntries(
    OPERATIONAL_READINESS_SERVICES.map(service => {
      let signal: OperationalSignal;
      if (isServerService(service.id)) {
        signal = evaluateServerSignal(service.id, attentionQuery.data?.areas, queryState);
      } else if (service.id === 'backup') {
        signal = evaluateBackupSignal(backupQuery.data?.status, {
          supported: Boolean(electron?.getBackupScheduleStatus),
          isAdmin,
          loading: backupQuery.isLoading,
          failed: backupQuery.isError || backupQuery.data?.success === false,
          maximumAgeHours: OPERATIONAL_READINESS_CONTRACT.backup.threshold.maximumAgeHours,
        });
      } else {
        signal = evaluateUpdateSignal(updateQuery.data, {
          supported: Boolean(electron?.getAutoUpdateStatus),
          loading: updateQuery.isLoading,
          failed: updateQuery.isError,
          maximumAgeHours: OPERATIONAL_READINESS_CONTRACT.updates.threshold.maximumAgeHours,
        });
      }
      return [service.id, signal];
    })
  ) as Record<OperationalServiceId, OperationalSignal>;

  const actionCount = Object.values(signals).filter(
    signal => signal.status === 'action_required'
  ).length;
  const watchCount = Object.values(signals).filter(signal => signal.status === 'watch').length;
  const drillCount = OPERATIONAL_READINESS_SERVICES.reduce(
    (sum, service) => sum + service.drills.length,
    0
  );

  return (
    <section className="card overflow-hidden" data-testid="operational-readiness-board">
      <header className="border-b border-line/75 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="pv-kicker">{t('ownership.kicker')}</p>
            <h2 className="pv-title text-xl">{t('ownership.title')}</h2>
            <p className="mt-2 text-sm text-secondary-600">{t('ownership.description')}</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label={t('ownership.summary.ariaLabel')}>
            <Badge variant={actionCount > 0 ? 'danger' : 'success'} marker="dot">
              {t('ownership.summary.action', { count: actionCount })}
            </Badge>
            <Badge variant={watchCount > 0 ? 'warning' : 'neutral'} marker="dot">
              {t('ownership.summary.watch', { count: watchCount })}
            </Badge>
            <Badge variant="outline">{t('ownership.summary.drills', { count: drillCount })}</Badge>
          </div>
        </div>
      </header>

      <div className="grid gap-px bg-line/70 md:grid-cols-2 xl:grid-cols-3">
        {OPERATIONAL_READINESS_SERVICES.map(service => {
          const Icon = SERVICE_ICONS[service.id];
          const signal = signals[service.id];
          const adminHandoff = service.ownerRole === 'administrator' && !isAdmin;
          const desktopControlSupported =
            service.id === 'backup'
              ? Boolean(electron?.getBackupScheduleStatus)
              : service.id === 'updates'
                ? Boolean(electron?.getAutoUpdateStatus)
                : true;
          const desktopRequired = service.source === 'desktop' && !desktopControlSupported;
          const observation = t(`ownership.observation.${signal.observation}`, {
            count: signal.count,
          });
          return (
            <article
              key={service.id}
              className="min-w-0 bg-card px-5 py-5 sm:px-6"
              data-testid={`operational-service-${service.id}`}
              data-status={signal.status}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="pv-gt pv-gt-primary h-10 w-10 shrink-0 rounded-xl">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <Badge variant={STATUS_VARIANTS[signal.status]} marker="dot">
                  {t(`ownership.status.${signal.status}`)}
                </Badge>
              </div>

              <h3 className="mt-4 font-semibold text-secondary-950">
                {t(`ownership.service.${service.id}`)}
              </h3>
              <p className="mt-1 min-h-10 text-sm text-secondary-600">{observation}</p>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/75 pt-4 text-xs">
                <div>
                  <dt className="pv-kicker">{t('ownership.labels.owner')}</dt>
                  <dd className="mt-1 font-semibold text-secondary-800">
                    {t(`ownership.owner.${service.ownerRole}`)}
                  </dd>
                </div>
                <div>
                  <dt className="pv-kicker">{t('ownership.labels.response')}</dt>
                  <dd className="mt-1 font-semibold text-secondary-800">
                    {t('ownership.responseMinutes', {
                      count: service.responseTargetMinutes,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="pv-kicker">{t('ownership.labels.threshold')}</dt>
                  <dd className="mt-1 text-secondary-700">
                    {t(`ownership.threshold.${service.id}`, {
                      count:
                        service.threshold.kind === 'queue'
                          ? service.threshold.warningCount
                          : service.threshold.kind === 'freshness'
                            ? service.threshold.maximumAgeHours
                            : service.threshold.dangerCount,
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="pv-kicker">{t('ownership.labels.runbook')}</dt>
                  <dd className="mt-1 text-secondary-700">
                    {t(`ownership.runbook.${service.id}`)}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-secondary-500">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {t('ownership.drillEvidence', { count: service.drills.length })}
                </span>
                {adminHandoff ? (
                  <Badge variant="outline" className="ml-auto max-w-full text-center">
                    {t('ownership.actions.adminHandoff')}
                  </Badge>
                ) : desktopRequired ? (
                  <Badge
                    variant="outline"
                    className="ml-auto max-w-full text-center"
                    data-testid={`operational-desktop-required-${service.id}`}
                  >
                    {t('ownership.actions.desktopRequired')}
                  </Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="compact"
                    onClick={() => {
                      if (service.id === 'sync' || service.source === 'desktop') {
                        onNavigate(service.actionTarget);
                      } else {
                        onReviewArea(service.id);
                      }
                    }}
                    aria-label={t('ownership.actions.actionAria', {
                      action: t(`ownership.actions.${service.id}`),
                      service: t(`ownership.service.${service.id}`),
                    })}
                    data-testid={`operational-action-${service.id}`}
                  >
                    {t(`ownership.actions.${service.id}`)}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
