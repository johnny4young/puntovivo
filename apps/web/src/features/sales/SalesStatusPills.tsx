import { useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { isOnline } from '@/lib/utils';

function subscribeToConnection(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

interface SalesStatusPillsProps {
  /** Product edits are frozen on this ticket, so the scanner is not listening. */
  scannerLocked: boolean;
  /** False when the site has no receipt printer configured. */
  hasReceiptPrinter: boolean;
}

/** Connection and device state for the register strip. */
export function SalesStatusPills({ scannerLocked, hasReceiptPrinter }: SalesStatusPillsProps) {
  const { t } = useTranslation('sales');
  const online = useSyncExternalStore(subscribeToConnection, isOnline, () => true);
  // Read-only: the shell's sync hook owns pushing, this only counts the queue.
  const syncStatus = trpc.sync.status.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const pending = syncStatus.data?.pendingCount ?? 0;

  const deviceLabel = scannerLocked
    ? t('quickSearch.lockedState')
    : hasReceiptPrinter
      ? t('sell.devices.ready')
      : t('sell.devices.noPrinter');
  const devicesReady = !scannerLocked && hasReceiptPrinter;

  return (
    <>
      {(!online || pending > 0) && (
        <span
          className="sales-pill bg-warning-50 text-warning-700"
          role="status"
          data-testid="sales-connection-pill"
        >
          {!online && <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>
            {online
              ? t('sell.connection.pending', { count: pending })
              : pending > 0
                ? t('sell.connection.offlinePending', { count: pending })
                : t('sell.connection.offline')}
          </span>
        </span>
      )}
      <span
        className={`sales-pill ${devicesReady ? 'bg-success-50 text-success-700' : 'bg-surface-3 text-fg2'}`}
        data-testid="sales-devices-pill"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${devicesReady ? 'bg-success-500' : 'bg-fg3'}`}
          aria-hidden="true"
        />
        {deviceLabel}
      </span>
    </>
  );
}
