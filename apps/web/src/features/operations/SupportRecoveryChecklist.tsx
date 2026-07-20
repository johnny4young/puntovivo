/**
 * permission-aware support recovery checklist.
 *
 * The checklist only links managers to Operations surfaces they can open.
 * Admin-only Setup actions remain visible as handoff guidance, but never as
 * links that would route a manager into a forbidden page.
 */

import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileArchive,
  HeartPulse,
  Laptop,
  RadioTower,
  type LucideIcon,
} from 'lucide-react';

export type SupportUpdateRecoveryState = 'healthy' | 'checking' | 'attention' | 'desktopOnly';

interface SupportRecoveryChecklistProps {
  isAdmin: boolean;
  updateState: SupportUpdateRecoveryState;
  staleDeviceCount: number;
  telemetryEnabled: boolean;
  hasSignalError: boolean;
  onNavigate: (route: string) => void;
}

interface RecoveryStepProps {
  id: 'updates' | 'devices' | 'telemetry' | 'evidence';
  icon: LucideIcon;
  tone: 'done' | 'block' | 'opt';
  title: string;
  description: string;
  status: string;
  action:
    { kind: 'navigate'; label: string; to: string } | { kind: 'admin-required'; label: string };
}

function RecoveryStep({
  id,
  icon: Icon,
  tone,
  title,
  description,
  status,
  action,
  onNavigate,
}: RecoveryStepProps & { onNavigate: (route: string) => void }) {
  return (
    <li
      className="pv-check !grid grid-cols-[1.625rem_minmax(0,1fr)] sm:grid-cols-[1.625rem_minmax(0,1fr)_auto]"
      data-testid={`support-recovery-${id}`}
    >
      <span className={`ic ${tone}`} aria-hidden="true">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t">{title}</span>
          <span
            className={`pv-badge ${tone === 'done' ? 'success' : tone === 'block' ? 'danger' : 'neutral'}`}
          >
            {status}
          </span>
        </div>
        <div className="d">{description}</div>
      </div>
      {action.kind === 'navigate' ? (
        <button
          type="button"
          onClick={() => onNavigate(action.to)}
          className="pv-btn outline col-start-2 mt-2 w-fit sm:col-start-3 sm:row-start-1 sm:mt-0 sm:shrink-0"
          data-testid={`support-recovery-action-${id}`}
        >
          {action.label}
        </button>
      ) : (
        <span
          className="pv-badge neutral col-start-2 mt-2 w-fit sm:col-start-3 sm:row-start-1 sm:mt-0 sm:shrink-0"
          data-testid={`support-recovery-action-${id}`}
        >
          {action.label}
        </span>
      )}
    </li>
  );
}

function updatePresentation(state: SupportUpdateRecoveryState): {
  icon: LucideIcon;
  tone: RecoveryStepProps['tone'];
} {
  if (state === 'healthy') return { icon: CheckCircle2, tone: 'done' };
  if (state === 'attention') return { icon: AlertTriangle, tone: 'block' };
  if (state === 'checking') return { icon: Clock3, tone: 'opt' };
  return { icon: Laptop, tone: 'opt' };
}

export function SupportRecoveryChecklist({
  isAdmin,
  updateState,
  staleDeviceCount,
  telemetryEnabled,
  hasSignalError,
  onNavigate,
}: SupportRecoveryChecklistProps) {
  const { t } = useTranslation('operations');
  const update = updatePresentation(updateState);

  const steps: RecoveryStepProps[] = [
    {
      id: 'updates',
      icon: update.icon,
      tone: update.tone,
      title: t('support.recovery.steps.updates.title'),
      description: t('support.recovery.steps.updates.description'),
      status: t(`support.recovery.steps.updates.status.${updateState}`),
      action: isAdmin
        ? {
            kind: 'navigate',
            label: t('support.recovery.actions.openUpdates'),
            to: '/company?tab=device',
          }
        : { kind: 'admin-required', label: t('support.recovery.actions.adminRequired') },
    },
    {
      id: 'devices',
      icon: staleDeviceCount > 0 ? AlertTriangle : RadioTower,
      tone: staleDeviceCount > 0 ? 'block' : 'done',
      title: t('support.recovery.steps.devices.title'),
      description: t('support.recovery.steps.devices.description'),
      status:
        staleDeviceCount > 0
          ? t('support.recovery.steps.devices.status.attention', { count: staleDeviceCount })
          : t('support.recovery.steps.devices.status.healthy'),
      action: {
        kind: 'navigate',
        label: t('support.recovery.actions.openDevices'),
        to: '/operations?tab=authority',
      },
    },
    {
      id: 'telemetry',
      icon: HeartPulse,
      tone: telemetryEnabled ? 'done' : 'opt',
      title: t('support.recovery.steps.telemetry.title'),
      description: t('support.recovery.steps.telemetry.description'),
      status: telemetryEnabled
        ? t('support.recovery.steps.telemetry.status.enabled')
        : t('support.recovery.steps.telemetry.status.disabled'),
      action: isAdmin
        ? {
            kind: 'navigate',
            label: t('support.recovery.actions.openTelemetry'),
            to: '/company?tab=data',
          }
        : { kind: 'admin-required', label: t('support.recovery.actions.adminRequired') },
    },
    {
      id: 'evidence',
      icon: FileArchive,
      tone: isAdmin ? 'done' : 'opt',
      title: t('support.recovery.steps.evidence.title'),
      description: t('support.recovery.steps.evidence.description'),
      status: isAdmin
        ? t('support.recovery.steps.evidence.status.ready')
        : t('support.recovery.steps.evidence.status.adminRequired'),
      action: {
        kind: 'navigate',
        label: t('support.recovery.actions.openDiagnostics'),
        to: '/operations?tab=diagnostics',
      },
    },
  ];

  return (
    <section className="card space-y-5 p-6" data-testid="support-recovery-checklist">
      <header>
        <p className="pv-kicker">{t('support.recovery.kicker')}</p>
        <h2 className="pv-title text-xl">{t('support.recovery.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-fg3">{t('support.recovery.description')}</p>
      </header>

      {hasSignalError && (
        <div className="pv-strip warning" role="status">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span>{t('support.recovery.partialSignals')}</span>
        </div>
      )}

      <ol className="divide-y divide-line/60" aria-label={t('support.recovery.listAriaLabel')}>
        {steps.map(step => (
          <RecoveryStep key={step.id} {...step} onNavigate={onNavigate} />
        ))}
      </ol>
    </section>
  );
}
