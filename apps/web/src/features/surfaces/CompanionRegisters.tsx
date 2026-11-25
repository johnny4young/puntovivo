import { useTranslation } from 'react-i18next';
import type { OperationsToday } from '@/features/dashboard/today/todayModel';
import { formatCurrency } from '@/lib/utils';

export interface ClosedRegister {
  id: string;
  registerName: string;
  closedAt: string | null;
  counted: boolean;
}

interface RegisterListProps {
  today: OperationsToday;
  closed: readonly ClosedRegister[];
  formatTime: (iso: string) => string;
  /** The Cajas tab also counts each register's sales. */
  detailed?: boolean;
}

/** Open registers with what they sold, drawers waiting to be received, and today's closed ones. */
export function CompanionRegisterList({
  today,
  closed,
  formatTime,
  detailed = false,
}: RegisterListProps) {
  const { t } = useTranslation('companion');
  const nothing =
    today.registers.length === 0 && today.awaitingHandoffs.length === 0 && closed.length === 0;
  if (nothing) {
    return (
      <p className="text-sm text-fg3" data-testid="companion-registers-empty">
        {t('registers.empty')}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line" data-testid="companion-registers">
      {today.registers.map(register => (
        <li
          key={register.sessionId}
          className="flex items-center justify-between gap-3 py-2.5"
          data-testid="companion-register-open"
        >
          <div className="min-w-0">
            <p className="text-[15px] leading-snug font-semibold text-fg1">
              {t('registers.register', {
                register: register.registerName,
                name: register.cashierName,
              })}
            </p>
            <p className="truncate text-[13px] text-fg3">
              {[
                register.lastHandoff
                  ? t('registers.receivedFrom', {
                      name: register.lastHandoff.fromUserName,
                      time: formatTime(register.lastHandoff.receivedAt),
                    })
                  : register.openedBeforeToday
                    ? t('registers.openedBefore')
                    : t('registers.openedAt', { time: formatTime(register.openedAt) }),
                detailed && t('registers.sales', { count: register.salesCount }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <p className="font-numeric shrink-0 text-[17px] font-bold text-fg1">
            {formatCurrency(register.salesTotal)}
          </p>
        </li>
      ))}
      {today.awaitingHandoffs.map(handoff => (
        <li key={handoff.id} className="py-2.5" data-testid="companion-register-awaiting">
          <p className="text-[15px] leading-snug font-semibold text-fg1">
            {t('registers.awaiting', {
              register: handoff.registerName,
              name: handoff.fromUserName,
            })}
          </p>
          <p className="truncate text-[13px] text-fg3">
            {handoff.toUserName
              ? t('registers.awaitingTo', {
                  time: formatTime(handoff.handedOverAt),
                  name: handoff.toUserName,
                })
              : t('registers.awaitingNobody', { time: formatTime(handoff.handedOverAt) })}
          </p>
        </li>
      ))}
      {closed.map(register => (
        <li
          key={register.id}
          className="py-2.5 text-[13px] text-fg3"
          data-testid="companion-register-closed"
        >
          {t(register.counted ? 'registers.closed' : 'registers.closedUncounted', {
            register: register.registerName,
            time: register.closedAt ? formatTime(register.closedAt) : '',
          })}
        </li>
      ))}
    </ul>
  );
}

export function CompanionRegisters(props: Omit<RegisterListProps, 'detailed'>) {
  const { t } = useTranslation('companion');
  return (
    <div className="space-y-4" data-testid="companion-registers-view">
      <h1 className="text-[1.9rem] leading-tight">{t('registers.title')}</h1>
      <CompanionRegisterList {...props} detailed />
    </div>
  );
}
