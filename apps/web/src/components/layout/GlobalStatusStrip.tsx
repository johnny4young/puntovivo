/**
 * Rediseño FASE 1 — Aviso global compacto (propuesta §01 hallazgo 02, §08).
 *
 * Reemplaza los dos banners fijos apilados (OfflineStatusBanner +
 * ReadinessBanner, ~150px sobre el contenido) por UN solo strip de 44px
 * codificado por severidad y colapsable. El detalle de cada aviso vive en
 * un centro de notificaciones que se despliega bajo el strip; ahí también
 * aparece la rejilla de capacidades offline (OfflineModePanel).
 *
 * Fusiona dos fuentes de estado sin perder comportamiento:
 *   - useOfflineSync + useHubReachability  → offline / pendientes / conflictos / hub.
 *   - setupReadiness.get (solo admin, fuera de /company) → bloqueadores de setup.
 *
 * La severidad del strip colapsado es la del aviso más grave (danger >
 * warning > info). El gating admin, el dismiss por sesión del readiness y
 * el reintento de sync se conservan exactamente como en los banners
 * originales.
 *
 * @module components/layout/GlobalStatusStrip
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, ChevronDown, CloudOff, RefreshCw, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useHubReachability } from '@/hooks/useHubReachability';
import { OfflineModePanel } from '@/features/offline/OfflineModePanel';
import { cn, formatDateTime } from '@/lib/utils';

/** Niveles de urgencia del strip, de mayor a menor peso visual. */
type StripSeverity = 'danger' | 'warning' | 'info';

const SEVERITY_RANK: Record<StripSeverity, number> = {
  danger: 3,
  warning: 2,
  info: 1,
};

/**
 * Un aviso individual dentro del centro de notificaciones. `action` es
 * opcional: `retry` dispara la cola de sync local; `link` navega a una
 * ruta de resolución (p. ej. el readiness card).
 */
interface StatusIssue {
  id: string;
  severity: StripSeverity;
  icon: ComponentType<{ className?: string }>;
  title: string;
  detail: string;
  hint?: string | undefined;
  action?:
    | { kind: 'retry'; label: string; busy: boolean }
    | { kind: 'link'; to: string; label: string }
    | undefined;
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string | undefined;
}

// Keep the legacy key so users who dismissed the old banner do not see it again
// mid-session after the compact strip replacement.
const READINESS_DISMISS_KEY = 'puntovivo:readinessBanner:dismissed';

function readReadinessDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(READINESS_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeReadinessDismissed(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(READINESS_DISMISS_KEY, '1');
    else window.sessionStorage.removeItem(READINESS_DISMISS_KEY);
  } catch {
    // Private-mode browsers throw on sessionStorage; swallow.
  }
}

/** Severidad → clase del strip (la receta por defecto es warning). */
function stripToneClass(severity: StripSeverity): string {
  if (severity === 'danger') return 'danger';
  if (severity === 'info') return 'info';
  return '';
}

export function GlobalStatusStrip() {
  const { t } = useTranslation('common');
  const { t: tSetup } = useTranslation('setup');
  const { user } = useAuth();
  const location = useLocation();

  const { isOnline, lastSync, pendingItems, conflicts, isSyncing, error, triggerSync } =
    useOfflineSync();
  const hub = useHubReachability();
  const isHubUnreachable = hub.reachable === false;

  const [expanded, setExpanded] = useState(false);
  const [, setReadinessDismissRevision] = useState(0);
  const readinessDismissed = readReadinessDismissed();

  // ENG-104 carryover — solo admins corren la consulta de readiness; el
  // CTA apunta a /company?tab=readiness (solo admin). Fuera de /company.
  const isSetupAdmin = user?.role === 'admin';
  const onCompanyRoute = location.pathname.startsWith('/company');
  const readinessQuery = trpc.setupReadiness.get.useQuery(undefined, {
    enabled: isSetupAdmin && !onCompanyRoute,
    staleTime: 60_000,
  });

  // Si el operador reconoce el setup o arregla el último bloqueador, el
  // payload propaga aquí y rehabilitamos el flag para una próxima vez.
  useEffect(() => {
    if (readinessQuery.data && readinessQuery.data.blockerCount === 0) {
      writeReadinessDismissed(false);
    }
  }, [readinessQuery.data]);

  // perf-002 — estable entre renders para que el useMemo de `issues` no
  // recree el cierre del aviso de readiness en cada render.
  const handleReadinessDismiss = useCallback(() => {
    writeReadinessDismissed(true);
    setReadinessDismissRevision(revision => revision + 1);
  }, []);

  const issues = useMemo<StatusIssue[]>(() => {
    const list: StatusIssue[] = [];

    // --- Aviso de sincronización / conectividad ---
    const showSync =
      isHubUnreachable || !isOnline || pendingItems > 0 || conflicts > 0 || Boolean(error);
    if (showSync) {
      let severity: StripSeverity;
      let icon: ComponentType<{ className?: string }>;
      let title: string;
      let detail: string;

      if (isHubUnreachable) {
        severity = 'danger';
        icon = AlertTriangle;
        title = t('offline.hubUnreachableTitle');
        detail = t('offline.hubUnreachableDesc');
      } else if (!isOnline) {
        severity = 'warning';
        icon = CloudOff;
        title = t('offline.youAreOffline');
        detail =
          pendingItems > 0
            ? t('offline.queuedChanges', { count: pendingItems })
            : t('offline.localChanges');
      } else if (conflicts > 0) {
        severity = 'danger';
        icon = AlertTriangle;
        title = t('offline.conflictsTitle');
        detail = t('offline.conflictsDesc', { count: conflicts });
      } else if (error) {
        severity = 'danger';
        icon = AlertTriangle;
        title = t('offline.attentionTitle');
        detail = error;
      } else {
        severity = 'info';
        icon = CloudOff;
        title = t('offline.pendingTitle');
        detail = t('offline.pendingDesc', { count: pendingItems });
      }

      const canRetry =
        !isHubUnreachable && isOnline && !isSyncing && pendingItems > 0 && conflicts === 0;

      list.push({
        id: 'sync',
        severity,
        icon,
        title,
        detail,
        hint: lastSync ? t('offline.lastSync', { date: formatDateTime(lastSync) }) : undefined,
        action: canRetry
          ? {
              kind: 'retry',
              label: isSyncing ? t('offline.syncing') : t('offline.retrySync'),
              busy: isSyncing,
            }
          : undefined,
      });
    }

    // --- Aviso de readiness / setup incompleto ---
    const readiness = readinessQuery.data;
    const showReadiness =
      isSetupAdmin &&
      !onCompanyRoute &&
      !readinessQuery.isLoading &&
      Boolean(readiness) &&
      (readiness?.blockerCount ?? 0) > 0 &&
      !readiness?.acknowledgedAt &&
      !readinessDismissed;
    if (showReadiness && readiness) {
      list.push({
        id: 'readiness',
        severity: 'danger',
        icon: AlertCircle,
        title: tSetup('banner.title', { count: readiness.blockerCount }),
        detail: tSetup('banner.detail', { count: readiness.blockerCount }),
        action: { kind: 'link', to: '/company?tab=readiness', label: tSetup('banner.cta') },
        onDismiss: handleReadinessDismiss,
        dismissLabel: tSetup('banner.dismiss'),
      });
    }

    return list.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }, [
    isHubUnreachable,
    isOnline,
    pendingItems,
    conflicts,
    error,
    isSyncing,
    lastSync,
    readinessQuery.data,
    readinessQuery.isLoading,
    isSetupAdmin,
    onCompanyRoute,
    readinessDismissed,
    handleReadinessDismiss,
    t,
    tSetup,
  ]);

  if (issues.length === 0) return null;

  const top = issues[0]!;
  const extraCount = issues.length - 1;
  const showCapabilityGrid = !isOnline || isHubUnreachable;
  const panelId = 'global-status-strip-detail';

  return (
    <div className="px-4 pt-3 sm:px-6 xl:px-8" data-testid="global-status-strip">
      <div className={cn('pv-strip', stripToneClass(top.severity))}>
        <span className="ic">
          <top.icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="msg">
          <b>{top.title}</b>
        </span>
        {extraCount > 0 && (
          <span className="pv-badge neutral" aria-hidden="true">
            {t('statusStrip.moreCount', { count: extraCount })}
          </span>
        )}
        <div className="act">
          {top.action?.kind === 'retry' && (
            <button
              type="button"
              className="pv-btn ghost"
              onClick={() => {
                void triggerSync();
              }}
              disabled={top.action.busy}
            >
              <RefreshCw
                className={cn('h-4 w-4', top.action.busy && 'animate-spin')}
                aria-hidden="true"
              />
              {top.action.label}
            </button>
          )}
          {top.action?.kind === 'link' && (
            <Link to={top.action.to} className="pv-btn ghost" data-testid="readiness-banner-cta">
              {top.action.label}
            </Link>
          )}
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? t('statusStrip.hideDetails') : t('statusStrip.showDetails')}
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {expanded && (
        <div
          id={panelId}
          className="card mt-2 space-y-3 p-4"
          role="region"
          aria-label={t('statusStrip.centerTitle')}
        >
          {issues.map(issue => (
            <div
              key={issue.id}
              className="flex flex-col gap-2 border-b border-line/60 pb-3 last:border-b-0 last:pb-0 md:flex-row md:items-start md:justify-between"
              data-testid={issue.id === 'readiness' ? 'readiness-banner' : undefined}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'pv-gt h-8 w-8',
                    issue.severity === 'danger' && 'pv-gt-danger',
                    issue.severity === 'warning' && 'pv-gt-warning',
                    issue.severity === 'info' && 'pv-gt-primary'
                  )}
                >
                  <issue.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg1">{issue.title}</p>
                  <p className="text-sm text-fg2">{issue.detail}</p>
                  {issue.hint && <p className="mt-0.5 text-xs text-fg3">{issue.hint}</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start md:self-center">
                {issue.action?.kind === 'retry' && (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      void triggerSync();
                    }}
                    disabled={issue.action.busy}
                  >
                    <RefreshCw
                      className={cn('h-4 w-4', issue.action.busy && 'animate-spin')}
                      aria-hidden="true"
                    />
                    {issue.action.label}
                  </button>
                )}
                {issue.action?.kind === 'link' && (
                  <Link to={issue.action.to} className="btn-outline">
                    {issue.action.label}
                  </Link>
                )}
                {issue.onDismiss && (
                  <button
                    type="button"
                    className="btn-ghost btn-icon"
                    aria-label={issue.dismissLabel}
                    onClick={issue.onDismiss}
                    data-testid="readiness-banner-dismiss"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <OfflineModePanel visible={showCapabilityGrid} />
        </div>
      )}
    </div>
  );
}
