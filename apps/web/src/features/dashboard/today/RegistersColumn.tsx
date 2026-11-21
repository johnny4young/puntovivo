import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SeverityMark } from '@/components/ui';
import {
  formatDuration,
  waitingRank,
  type OperationsToday,
  type TodayPendingItem,
  type TodayRegister,
} from './todayModel';

interface RegistersColumnProps {
  today: OperationsToday;
  numbered: ReadonlyArray<{ item: TodayPendingItem; rank: number }>;
  canOpenRegister: boolean;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
}

function handoffLine(
  handoff: NonNullable<TodayRegister['lastHandoff']>,
  t: ReturnType<typeof useTranslation>['t'],
  formatCurrency: (value: number) => string,
  formatTime: (iso: string) => string
) {
  const time = formatTime(handoff.receivedAt);
  return handoff.countDifference
    ? t('today.registers.receivedDifference', {
        time,
        from: handoff.fromUserName,
        difference: formatCurrency(handoff.countDifference),
      })
    : t('today.registers.received', { time, from: handoff.fromUserName });
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
        {today.registers.length === 0 && today.awaitingHandoffs.length === 0 && (
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
                  <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-danger-700">
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
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-danger-700">
                    <SeverityMark severity="blocks" size={11} />
                    {t('today.registers.waiting', { rank })}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs font-semibold whitespace-nowrap text-success-700">
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
              {register.lastHandoff && (
                <p
                  className={`text-sm ${register.lastHandoff.countDifference ? 'text-danger-700' : 'text-fg3'}`}
                  data-testid="today-register-handoff"
                >
                  {handoffLine(register.lastHandoff, t, formatCurrency, formatTime)}
                </p>
              )}
            </article>
          );
        })}

        {today.awaitingHandoffs.map(handoff => (
          <article
            key={handoff.id}
            data-testid="today-register-awaiting"
            className="rounded-[18px] border border-line bg-surface-2 px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-[0.95rem]">
              <b>{t('today.registers.handedOver', { register: handoff.registerName })}</b>
              <span className="shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-warning-700">
                {handoff.toUserName
                  ? t('today.registers.waitingFor', { to: handoff.toUserName })
                  : t('today.registers.waitingAnyone')}
              </span>
            </div>
            <p className="mt-1 text-sm text-fg2">
              {t('today.registers.handedOverBy', {
                from: handoff.fromUserName,
                time: formatTime(handoff.handedOverAt),
              })}
            </p>
          </article>
        ))}

        {handoff && (
          <div
            className="rounded-[18px] bg-rail px-4 py-3 text-rail-foreground"
            data-testid="today-next-handoff"
          >
            <p className="text-xs font-semibold tracking-[0.14em] uppercase opacity-80">
              {t('today.registers.nextIn')}
            </p>
            <p className="font-numeric text-[2.2rem] leading-tight">
              {formatDuration(
                Math.max(
                  0,
                  Math.round((Date.parse(handoff.at) - Date.parse(today.generatedAt)) / 60_000)
                ),
                t
              )}
            </p>
            <p className="text-sm" data-testid="today-next-handoff-detail">
              {handoff.toUserName
                ? t('today.registers.handoffTo', {
                    register: handoff.registerName ?? '',
                    from: handoff.fromUserName,
                    to: handoff.toUserName,
                  })
                : t('today.registers.handoff', {
                    register: handoff.registerName ?? '',
                    from: handoff.fromUserName,
                  })}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
