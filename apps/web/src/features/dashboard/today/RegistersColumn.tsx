import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SeverityMark } from '@/components/ui';
import { waitingRank, type OperationsToday, type TodayPendingItem } from './todayModel';

interface RegistersColumnProps {
  today: OperationsToday;
  numbered: ReadonlyArray<{ item: TodayPendingItem; rank: number }>;
  canOpenRegister: boolean;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
}

function formatDuration(ms: number, t: ReturnType<typeof useTranslation>['t']) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? t('today.registers.durationHours', { hours, minutes: minutes % 60 })
    : t('today.registers.durationMinutes', { minutes });
}

export function RegistersColumn({
  today,
  numbered,
  canOpenRegister,
  formatCurrency,
  formatTime,
}: RegistersColumnProps) {
  const { t } = useTranslation('dashboard');
  const handoff = today.nextHandoff;

  return (
    <section aria-labelledby="today-registers-title" data-testid="today-registers">
      <div className="flex items-center gap-3">
        <h2 id="today-registers-title" className="text-[2rem] leading-none">
          {t('today.registers.title')}
        </h2>
        {canOpenRegister && (
          <Link
            to="/sales"
            className="btn-outline ml-auto min-h-10 px-3 text-sm"
            data-testid="today-open-register"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('today.registers.open')}
          </Link>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {today.registers.length === 0 && (
          <p className="text-fg3" data-testid="today-registers-empty">
            {t('today.registers.empty')}
          </p>
        )}
        {today.registers.map(register => {
          const rank = waitingRank(register, numbered);
          return register.openedBeforeToday ? (
            <article
              key={register.sessionId}
              data-testid="today-register-stale"
              className="rounded-[18px] border-2 border-dashed border-danger-500 bg-danger-50 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2 text-[0.95rem]">
                <b>
                  {t('today.registers.name', {
                    register: register.registerName,
                    cashier: register.cashierName,
                  })}
                </b>
                {rank !== null && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-danger-700">
                    {t('today.registers.isItem', { rank })}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-fg2">
                {t('today.registers.openSince', { time: formatTime(register.openedAt) })}
              </p>
            </article>
          ) : (
            <article
              key={register.sessionId}
              data-testid="today-register"
              className="rounded-[18px] border border-line bg-surface px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2 text-[0.95rem]">
                <b>
                  {t('today.registers.name', {
                    register: register.registerName,
                    cashier: register.cashierName,
                  })}
                </b>
                {rank !== null ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold text-danger-700">
                    <SeverityMark severity="blocks" size={11} />
                    {t('today.registers.waiting', { rank })}
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-success-700">
                    {t('today.registers.selling')}
                  </span>
                )}
              </div>
              <p className="font-numeric text-[2.4rem] leading-tight">
                {formatCurrency(register.salesTotal)}
              </p>
              <p className="text-sm text-fg3">
                {register.scheduledEndAt
                  ? t('today.registers.salesAndHandoff', {
                      count: register.salesCount,
                      time: formatTime(register.scheduledEndAt),
                    })
                  : t('today.registers.sales', { count: register.salesCount })}
              </p>
            </article>
          );
        })}

        {handoff && (
          <div
            className="rounded-[18px] bg-rail px-4 py-3 text-rail-foreground"
            data-testid="today-next-handoff"
          >
            <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-80">
              {t('today.registers.nextIn')}
            </p>
            <p className="font-numeric text-[2.2rem] leading-tight">
              {formatDuration(Date.parse(handoff.at) - Date.parse(today.generatedAt), t)}
            </p>
            <p className="text-sm">
              {t('today.registers.handoff', {
                register: handoff.registerName ?? '',
                from: handoff.fromUserName,
              })}
            </p>
          </div>
        )}

        {today.handoffs.length > 0 && (
          <ul
            className="flex flex-col gap-1.5"
            aria-label={t('today.registers.handoffsLabel')}
            data-testid="today-handoffs"
          >
            {today.handoffs.map(entry => (
              <li
                key={entry.id}
                className="flex items-center gap-2 text-sm text-fg2"
                data-testid="today-handoff"
              >
                <SeverityMark severity={entry.receivedAt ? 'ready' : 'whenPossible'} size={14} />
                {entry.receivedAt
                  ? t('today.registers.handoffDone', {
                      register: entry.registerName,
                      time: formatTime(entry.receivedAt),
                    })
                  : t('today.registers.handoffWaiting', {
                      register: entry.registerName,
                      time: formatTime(entry.createdAt),
                    })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
