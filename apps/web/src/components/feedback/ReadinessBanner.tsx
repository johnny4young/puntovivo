/**
 * ENG-104 — Sticky readiness banner.
 *
 * Renders below the main header whenever `setupReadiness.get`
 * reports unresolved blockers AND the operator has NOT
 * acknowledged the setup AND the current route is not `/company`
 * (the readiness card lives there — no need to re-tell the operator
 * to go there from there). The banner is dismissible within the
 * current session via sessionStorage; durable opt-out lives behind
 * `companies.acknowledgeSetup` and is surfaced from the readiness
 * card itself.
 *
 * Non-admin roles never see the banner — their flow is POS-direct or
 * operations-focused, while the readiness checklist deep-links into
 * admin-only setup surfaces. Same gate as the post-login routing in
 * `roleAccess.ts`.
 *
 * @module components/feedback/ReadinessBanner
 */

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

const DISMISS_STORAGE_KEY = 'puntovivo:readinessBanner:dismissed';

function readDismissedFlag(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_STORAGE_KEY) === '1';
  } catch {
    // Private-mode browsers can throw on sessionStorage access; fall
    // back to "not dismissed" so the operator still sees the banner.
    return false;
  }
}

function writeDismissedFlag(value: boolean): void {
  try {
    if (value) {
      window.sessionStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(DISMISS_STORAGE_KEY);
    }
  } catch {
    // Same private-mode swallow as above.
  }
}

export function ReadinessBanner() {
  const { t } = useTranslation('setup');
  const { user } = useAuth();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(() => readDismissedFlag());

  // ENG-104 — only admins run the readiness query from the shell.
  // The CTA points at `/company?tab=readiness`, which is admin-only
  // today, so managers should not see a link they cannot open.
  const isSetupAdmin = user?.role === 'admin';

  const readinessQuery = trpc.setupReadiness.get.useQuery(undefined, {
    enabled: isSetupAdmin,
    staleTime: 60_000,
  });

  // If the operator persists `acknowledgedAt` via the card, the
  // server payload mutation propagates here and we collapse the
  // banner automatically. Same flow for fixing the last blocker —
  // the next refetch shrinks blockerCount to 0 and we go silent.
  useEffect(() => {
    if (readinessQuery.data && readinessQuery.data.blockerCount === 0) {
      writeDismissedFlag(false);
    }
  }, [readinessQuery.data]);

  if (!isSetupAdmin) return null;
  if (location.pathname.startsWith('/company')) return null;
  if (readinessQuery.isLoading) return null;
  if (!readinessQuery.data) return null;
  if (readinessQuery.data.blockerCount === 0) return null;
  if (readinessQuery.data.acknowledgedAt) return null;
  if (dismissed) return null;

  const { blockerCount } = readinessQuery.data;

  return (
    <div
      className="bg-danger-50 border-b border-danger-200 px-4 py-2 flex items-center justify-between gap-3"
      role="status"
      data-testid="readiness-banner"
    >
      <div className="flex items-center gap-2 text-sm text-danger-800">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          {t('banner.title', { count: blockerCount })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/company?tab=readiness"
          className="text-sm font-medium text-danger-900 underline hover:text-danger-700"
          data-testid="readiness-banner-cta"
        >
          {t('banner.cta')}
        </Link>
        <button
          type="button"
          aria-label={t('banner.dismiss')}
          className="p-1 text-danger-700 hover:text-danger-900"
          onClick={() => {
            writeDismissedFlag(true);
            setDismissed(true);
          }}
          data-testid="readiness-banner-dismiss"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
