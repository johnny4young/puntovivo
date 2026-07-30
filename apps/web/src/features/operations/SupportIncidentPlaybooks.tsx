/**
 * Guided first-response playbooks for workstation-loss incidents.
 *
 * Each action lands on an existing recovery surface with real authority:
 * device revocation or encrypted backup/restore. The playbooks never imply
 * that navigation alone resolves the incident.
 */

import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  HardDriveDownload,
  Laptop,
  MonitorX,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, StatusStrip } from '@/components/ui';

interface SupportIncidentPlaybooksProps {
  isAdmin: boolean;
  isDesktop: boolean;
  onNavigate: (route: string) => void;
}

type PlaybookAction =
  | {
      kind: 'navigate';
      label: string;
      to: string;
    }
  | {
      kind: 'admin-required' | 'desktop-required';
      label: string;
    };

interface Playbook {
  id: 'lostDevice' | 'damagedStorage';
  icon: LucideIcon;
  tone: 'danger' | 'warning';
  action: PlaybookAction;
}

function PlaybookActionControl({
  id,
  action,
  onNavigate,
}: {
  id: Playbook['id'];
  action: PlaybookAction;
  onNavigate: (route: string) => void;
}) {
  if (action.kind !== 'navigate') {
    return (
      <Badge variant="neutral" data-testid={`support-playbook-action-${id}`}>
        {action.label}
      </Badge>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => onNavigate(action.to)}
      data-testid={`support-playbook-action-${id}`}
    >
      {id === 'lostDevice' ? (
        <ShieldCheck aria-hidden="true" />
      ) : (
        <HardDriveDownload aria-hidden="true" />
      )}
      {action.label}
    </Button>
  );
}

export function SupportIncidentPlaybooks({
  isAdmin,
  isDesktop,
  onNavigate,
}: SupportIncidentPlaybooksProps) {
  const { t } = useTranslation('incidentPlaybooks');
  const playbooks: Playbook[] = [
    {
      id: 'lostDevice',
      icon: MonitorX,
      tone: 'danger',
      action: isAdmin
        ? {
            kind: 'navigate',
            label: t('actions.reviewDevices'),
            to: '/operations?tab=authority',
          }
        : {
            kind: 'admin-required',
            label: t('actions.adminRequired'),
          },
    },
    {
      id: 'damagedStorage',
      icon: Laptop,
      tone: 'warning',
      action: !isAdmin
        ? {
            kind: 'admin-required',
            label: t('actions.adminRequired'),
          }
        : !isDesktop
          ? {
              kind: 'desktop-required',
              label: t('actions.desktopRequired'),
            }
          : {
              kind: 'navigate',
              label: t('actions.openBackup'),
              to: '/company?tab=data',
            },
    },
  ];

  return (
    <section className="card space-y-5 p-6" data-testid="support-incident-playbooks">
      <header className="flex items-start gap-3">
        <span className="pv-gt pv-gt-warning h-11 w-11 rounded-xl">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="pv-kicker">{t('kicker')}</p>
          <h2 className="pv-title text-xl">{t('title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg3">{t('description')}</p>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        {playbooks.map(playbook => {
          const Icon = playbook.icon;
          return (
            <article
              key={playbook.id}
              className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line/80 bg-surface-1 p-5"
              data-testid={`support-playbook-${playbook.id}`}
            >
              <header className="flex items-start gap-3">
                <span
                  className={`pv-gt h-10 w-10 shrink-0 rounded-xl ${
                    playbook.tone === 'danger' ? 'pv-gt-danger' : 'pv-gt-warning'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold text-fg">{t(`${playbook.id}.title`)}</h3>
                  <p className="mt-1 text-sm text-fg3">{t(`${playbook.id}.description`)}</p>
                </div>
              </header>

              <StatusStrip
                tone={playbook.tone}
                icon={playbook.tone === 'danger' ? MonitorX : HardDriveDownload}
                title={t(`${playbook.id}.safety`)}
              />

              <ol
                className="space-y-2 text-sm text-fg2"
                aria-label={t(`${playbook.id}.stepsAriaLabel`)}
              >
                {[1, 2, 3].map(step => (
                  <li key={step} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary-100 font-mono text-[0.65rem] font-semibold text-fg2"
                      aria-hidden="true"
                    >
                      {step}
                    </span>
                    <span>{t(`${playbook.id}.steps.${step}`)}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-auto flex justify-end pt-1">
                <PlaybookActionControl
                  id={playbook.id}
                  action={playbook.action}
                  onNavigate={onNavigate}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
