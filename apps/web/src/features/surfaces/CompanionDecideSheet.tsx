import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { SeverityMark } from '@/components/ui';
import { ApprovalDecisionContext } from '@/features/approvals/ApprovalDecisionContext';
import { percent } from '@/features/approvals/approvalPercent';
import {
  ApprovalDecisionForm,
  type ApprovalDecision,
} from '@/features/approvals/ManagerApprovalQueue';
import type { OperationsToday } from '@/features/dashboard/today/todayModel';
import { cn, formatCurrency } from '@/lib/utils';
import {
  approvalWhat,
  counterOffer,
  requestedPercent,
  shownAmount,
  waitingPlace,
  type QueueItem,
} from './companionApproval';

interface CompanionDecideSheetProps {
  item: QueueItem | null;
  /** The queue is still loading, so a missing item is not yet gone. */
  loading: boolean;
  /** The queue read failed, so a missing item may still be waiting. */
  failed: boolean;
  /** Drawn over the dark sealed day; the sheet portals outside the shell's theme. */
  dark: boolean;
  approverId: string | null;
  today: OperationsToday | undefined;
  formatTime: (iso: string) => string;
  onClose: () => void;
  onDecided: () => void;
}

type Step = { decision: ApprovalDecision; reason?: string; label: string } | null;

/** One approval with what the owner needs to weigh it, decided with their PIN. */
export function CompanionDecideSheet({
  item,
  loading,
  failed,
  dark,
  approverId,
  today,
  formatTime,
  onClose,
  onDecided,
}: CompanionDecideSheetProps) {
  const { t } = useTranslation(['companion', 'common']);

  return (
    <Drawer
      isOpen
      onClose={onClose}
      ariaLabel={item ? approvalWhat(item, t) : t('decide.loading')}
      showCloseButton={false}
      size="md"
      className={cn('bg-surface', dark && 'dark')}
      contentClassName="p-0 sm:p-0"
    >
      <div className="px-5 pt-2 pb-5" data-testid="companion-decide-sheet">
        <div className="flex items-center">
          <span aria-hidden="true" className="mx-auto h-1.5 w-10 rounded-full bg-fg4" />
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 grid h-9 w-9 place-items-center rounded-full text-fg3 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-100"
            aria-label={t('decide.close')}
            data-testid="companion-decide-close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {!item ? (
          <p className="py-6 text-center text-fg2" role="status">
            {loading ? t('decide.loading') : failed ? t('decide.unavailable') : t('decide.gone')}
          </p>
        ) : (
          <DecideBody
            item={item}
            today={today}
            formatTime={formatTime}
            approverId={approverId}
            onDecided={onDecided}
          />
        )}
      </div>
    </Drawer>
  );
}

function DecideBody({
  item,
  today,
  formatTime,
  approverId,
  onDecided,
}: {
  item: QueueItem;
  today: OperationsToday | undefined;
  formatTime: (iso: string) => string;
  approverId: string | null;
  onDecided: () => void;
}) {
  const { t } = useTranslation(['companion', 'common']);
  const [step, setStep] = useState<Step>(null);
  const share = requestedPercent(item);
  const ticket = item.decisionContext?.ticket;
  const counter = counterOffer(item);
  const counterShare = counter === null ? null : percent(counter);
  const discount = item.action === 'sale_discount';
  const amount = shownAmount(item);
  const approveLabel =
    discount && share ? t('decide.approvePercent', { percent: share }) : t('decide.approve');

  return (
    <>
      <p className="mt-1 flex items-start gap-2 text-[13px] font-bold tracking-[0.04em] text-danger-700 uppercase">
        <span className="mt-[3px] shrink-0">
          <SeverityMark severity="blocks" size={12} />
        </span>
        {t('decide.blocks', { place: waitingPlace(item, today) })}
      </p>
      <h2 className="mt-1 text-[1.45rem] leading-tight font-semibold text-fg1">
        {discount && share
          ? t('decide.discountTitle', { percent: share })
          : t(`common:userMenu.approvals.actions.${item.action}`)}
      </h2>
      {amount !== null && (
        <p
          className="font-numeric mt-1 text-[3.6rem] leading-none font-extrabold text-fg1"
          data-testid="companion-decide-amount"
        >
          {discount && '-'}
          {amount}
        </p>
      )}
      {ticket && (
        <p className="mt-2 text-sm text-fg3" data-testid="companion-decide-ticket">
          {ticket.totalBefore !== null && (
            <>
              <s>{formatCurrency(ticket.totalBefore, item.summary.currencyCode)}</s>
              <span aria-hidden="true"> → </span>
            </>
          )}
          <b className="font-numeric text-fg1">
            {formatCurrency(ticket.total, item.summary.currencyCode)}
          </b>
          {' · '}
          {t('decide.items', { count: ticket.itemCount })}
        </p>
      )}
      {item.decisionContext && (
        <div className="mt-3">
          <ApprovalDecisionContext
            requestId={item.id}
            requesterName={item.requesterName}
            context={item.decisionContext}
            large
          />
        </div>
      )}
      <figure
        className="mt-3 rounded-[14px] border border-dashed border-line px-4 py-3"
        data-testid="companion-decide-note"
      >
        <figcaption className="text-[11px] font-semibold tracking-[0.12em] text-fg3 uppercase">
          {item.requesterName} · {formatTime(item.requestedAt)}
        </figcaption>
        <blockquote className="mt-1 text-sm text-fg1">«{item.reason}»</blockquote>
      </figure>

      <div className="mt-5">
        {!approverId ? (
          <p className="text-sm text-fg3" data-testid="companion-decide-pin-missing">
            {t('common:userMenu.approvals.pinMissing')}
          </p>
        ) : step ? (
          <ApprovalDecisionForm
            key={step.label}
            requestId={item.id}
            decision={step.decision}
            approverId={approverId}
            fixedReason={step.reason}
            submitLabel={step.label}
            large
            onCancel={() => setStep(null)}
            onDecided={onDecided}
          />
        ) : (
          <div className="space-y-2.5">
            <button
              type="button"
              className="btn-primary h-14 w-full justify-center rounded-2xl text-[17px]"
              onClick={() => setStep({ decision: 'approved', label: approveLabel })}
              data-testid="companion-decide-approve"
            >
              {approveLabel}
            </button>
            <div className="flex gap-2.5">
              {counterShare !== null && (
                <button
                  type="button"
                  className="btn-outline h-12 flex-1 justify-center rounded-2xl text-base"
                  onClick={() =>
                    setStep({
                      decision: 'rejected',
                      reason: t('decide.counterReason', { percent: counterShare }),
                      label: t('decide.counter', { percent: counterShare }),
                    })
                  }
                  data-testid="companion-decide-counter"
                >
                  {t('decide.counter', { percent: counterShare })}
                </button>
              )}
              <button
                type="button"
                className="btn-outline h-12 flex-1 justify-center rounded-2xl text-base"
                onClick={() => setStep({ decision: 'rejected', label: t('decide.reject') })}
                data-testid="companion-decide-reject"
              >
                {t('decide.reject')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
