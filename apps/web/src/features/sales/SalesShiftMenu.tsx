import { useEffect, useRef, useState } from 'react';
import { ChevronDown, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CashierPaceStrip } from '@/features/sales/CashierPaceStrip';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';
import { formatDateTime } from '@/lib/utils';
import type { CashSession, UserRole } from '@/types';

interface SalesShiftMenuProps {
  cashSession: CashSession;
  userRole?: UserRole | undefined;
  canCloseCashSession: boolean;
  hubReachable?: boolean | undefined;
  onOpenMovement: () => void;
  onKickCashDrawer?: (() => void | Promise<void>) | undefined;
  isKickingCashDrawer?: boolean | undefined;
  onHandOver?: (() => void) | undefined;
  onCloseCashSession: () => void;
}

export function SalesShiftMenu({
  cashSession,
  userRole,
  canCloseCashSession,
  hubReachable,
  onOpenMovement,
  onKickCashDrawer,
  isKickingCashDrawer,
  onHandOver,
  onCloseCashSession,
}: SalesShiftMenuProps) {
  const { t } = useTranslation('sales');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasSupervisedClose = userRole === 'admin' || userRole === 'manager';
  const isHubGated = hubReachable === false;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const runAndClose = (action: () => void | Promise<void>) => {
    setOpen(false);
    void action();
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        className="sales-strip-action btn-outline flex min-w-0 flex-none items-center justify-center gap-1.5 whitespace-nowrap"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="sales-shift-menu"
        onClick={() => setOpen(current => !current)}
      >
        <WalletCards className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium">{t('cashSession.title')}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('cashSession.title')}
          data-testid="sales-shift-popover"
          className="operator-popover absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-lg"
        >
          <div className="space-y-1 border-b border-line pb-2.5 text-xs text-fg2">
            <p className="font-medium text-fg1">
              {t('cashSession.openedAt')}: {formatDateTime(cashSession.openedAt)}
            </p>
            <CashierPaceStrip hasActiveCashSession />
            <p className="text-fg3">
              {t(
                hasSupervisedClose
                  ? 'cashSession.supervisedCloseHint'
                  : 'cashSession.blindCloseHint'
              )}
            </p>
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <button
              type="button"
              role="menuitem"
              className="btn-outline w-full justify-start text-sm"
              onClick={() => runAndClose(onOpenMovement)}
              aria-keyshortcuts={ariaKeyshortcutsFor('sales.cashMovement')}
            >
              {t('cashSession.recordMovementAction')}
            </button>
            {onKickCashDrawer && (
              <button
                type="button"
                role="menuitem"
                className="btn-outline w-full justify-start text-sm"
                onClick={() => runAndClose(onKickCashDrawer)}
                disabled={isKickingCashDrawer}
                data-testid="sales-kick-drawer"
              >
                {t('printer.kickDrawerCta')}
              </button>
            )}
            {onHandOver && (
              <button
                type="button"
                role="menuitem"
                className="btn-outline w-full justify-start text-sm"
                onClick={() => runAndClose(onHandOver)}
                data-testid="sales-hand-over"
              >
                {t('cashSession.handOverAction')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="btn-outline w-full justify-start text-sm"
              onClick={() => runAndClose(onCloseCashSession)}
              disabled={isHubGated || !canCloseCashSession}
              aria-keyshortcuts={ariaKeyshortcutsFor('sales.closeCashSession')}
            >
              {t('cashSession.closeAction')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
