import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

const TIMELINE_LIMIT = 100;

/** What moved the expected balance during the shift; only supervised closes may see it. */
export function CashMovementTimeline({
  sessionId,
  enabled,
}: {
  sessionId: string;
  enabled: boolean;
}) {
  const { t } = useTranslation('sales');
  const movementsQuery = trpc.cashSessions.movements.useQuery(
    { sessionId, limit: TIMELINE_LIMIT },
    { enabled }
  );
  const movements = movementsQuery.data ?? [];

  return (
    <aside
      className="mt-4 rounded-[16px] border border-line bg-surface p-4 lg:sticky lg:top-0 lg:mt-0"
      aria-label={t('cashSession.timeline.title')}
      data-testid="close-session-timeline"
    >
      <h3 className="text-sm font-semibold text-ink">{t('cashSession.timeline.title')}</h3>
      {movementsQuery.isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {t('cashSession.timeline.loading')}
        </p>
      ) : movements.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('cashSession.timeline.empty')}</p>
      ) : (
        <ol className="mt-2 max-h-[22rem] space-y-2 overflow-y-auto">
          {movements.map(movement => (
            <li key={movement.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink">
                  {t(`cashSession.movementTypes.${movement.type}`)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateTime(movement.createdAt)}
                </span>
              </span>
              <span
                className={`shrink-0 font-medium tabular-nums ${
                  movement.signedAmount < 0 ? 'text-danger-700' : 'text-success-700'
                }`}
              >
                {movement.signedAmount > 0 ? '+' : ''}
                {formatCurrency(movement.signedAmount)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
