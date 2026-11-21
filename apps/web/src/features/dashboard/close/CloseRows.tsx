import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AlertTriangle, Check, CircleDashed } from 'lucide-react';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { ToggleChip } from '@/features/sales/handoff/HandoffFrame';
import {
  DIFFERENCE_REASONS,
  fiscalInProgress,
  lastClosed,
  type CloseDraft,
  type CloseReport,
  type CloseSession,
  type DifferenceReason,
} from './closeModel';

export type RowState = 'done' | 'todo' | 'info';

// Mirrors the server's explainDifference note limits.
const NOTE_MIN = 3;
const NOTE_MAX = 240;

export function RowIcon({ state, rank }: { state: RowState; rank?: number }) {
  if (state === 'done') {
    return (
      <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-success-700 text-surface">
        <Check className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }
  if (state === 'info') {
    return (
      <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-warning-50 text-warning-700">
        <CircleDashed className="h-4 w-4" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 border-fg1 text-[15px] font-semibold tabular-nums text-fg1">
      {rank ?? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
    </span>
  );
}

export function CloseRow({
  state,
  title,
  detail,
  actions,
  testId,
  children,
}: {
  state: RowState;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <li
      data-testid={testId}
      data-state={state}
      className="flex min-h-[74px] flex-wrap items-center gap-x-3.5 gap-y-2 border-t-[1.5px] border-line py-2"
    >
      <RowIcon state={state} />
      <div className="min-w-0 flex-1">
        <p className="text-[16.5px] font-semibold text-fg1">{title}</p>
        {detail && <p className="text-sm text-fg3">{detail}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {children}
    </li>
  );
}

export function RegistersRow({
  open,
  closed,
  formatTime,
}: {
  open: CloseSession[];
  closed: CloseSession[];
  formatTime: (iso: string) => string;
}) {
  const { t } = useTranslation('dayCloseGuide');
  const total = open.length + closed.length;
  const last = lastClosed(closed);
  let detail: string | undefined;
  if (open.length === 1) {
    detail = t('registers.openOne', {
      register: open[0]!.registerName,
      name: open[0]!.cashierName,
    });
  } else if (open.length > 1) {
    detail = t('registers.openMany', { count: open.length });
  } else if (last?.closedAt) {
    detail = t(last.counted ? 'registers.lastCounted' : 'registers.last', {
      register: last.registerName,
      name: last.cashierName,
      time: formatTime(last.closedAt),
    });
  }
  return (
    <CloseRow
      state={open.length > 0 ? 'todo' : 'done'}
      testId="day-close-row-registers"
      title={
        total === 0 ? t('registers.none') : t('registers.title', { closed: closed.length, total })
      }
      detail={detail}
      actions={
        open.length > 0 && (
          <Link
            to="/operations?tab=cash"
            className="btn-outline min-h-9 rounded-full px-3.5 text-sm"
            data-testid="day-close-registers-review"
          >
            {t('registers.review')}
          </Link>
        )
      }
    />
  );
}

export function DifferenceRow({
  session,
  frozen,
  busy,
  formatCurrency,
  formatTime,
  onExplain,
}: {
  session: CloseSession;
  frozen: boolean;
  busy: boolean;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
  onExplain: (reason: DifferenceReason, note?: string) => void;
}) {
  const { t } = useTranslation('dayCloseGuide');
  const [otherOpen, setOtherOpen] = useState(false);
  const [note, setNote] = useState(session.differenceNote ?? '');
  const explained = session.differenceReason !== null;
  const amount = formatCurrency(session.overShort ?? 0);
  const noteId = useId();
  return (
    <CloseRow
      state={explained ? 'done' : 'todo'}
      testId={`day-close-row-difference-${session.id}`}
      title={t(explained ? 'difference.explained' : 'difference.pending', {
        register: session.registerName,
        amount,
      })}
      detail={
        session.differenceReason === 'other' && session.differenceNote
          ? session.differenceNote
          : session.closedAt
            ? t('difference.detail', {
                name: session.cashierName,
                time: formatTime(session.closedAt),
              })
            : undefined
      }
      actions={
        !frozen && (
          <div
            role="group"
            aria-label={t('difference.reasonGroup', { register: session.registerName })}
            className="flex flex-wrap gap-2"
          >
            {DIFFERENCE_REASONS.map(reason => (
              <ToggleChip
                key={reason}
                pressed={
                  reason === 'other'
                    ? otherOpen || session.differenceReason === 'other'
                    : session.differenceReason === reason
                }
                label={t(`difference.reasons.${reason}`)}
                testId={`day-close-reason-${reason}-${session.id}`}
                onClick={() => {
                  if (busy) return;
                  if (reason === 'other') {
                    setOtherOpen(open => !open);
                    return;
                  }
                  setOtherOpen(false);
                  onExplain(reason);
                }}
              />
            ))}
          </div>
        )
      }
    >
      {otherOpen && !frozen && (
        <form
          className="flex w-full items-end gap-2 pl-10"
          onSubmit={event => {
            event.preventDefault();
            if (note.trim().length < NOTE_MIN) return;
            onExplain('other', note.trim());
            setOtherOpen(false);
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={noteId} className="mb-1 block text-[13px] text-fg3">
              {t('difference.noteLabel')}
            </label>
            <input
              id={noteId}
              className="input w-full"
              value={note}
              maxLength={NOTE_MAX}
              onChange={event => setNote(event.target.value)}
              data-testid={`day-close-reason-note-${session.id}`}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={busy || note.trim().length < NOTE_MIN}>
            {t('difference.save')}
          </Button>
        </form>
      )}
    </CloseRow>
  );
}

/** A sale parked before the day ended: discard it or leave it for tomorrow. */
export function DraftRow({
  draft,
  frozen,
  busy,
  formatCurrency,
  formatTime,
  onDiscard,
  onCarry,
}: {
  draft: CloseDraft;
  frozen: boolean;
  busy: boolean;
  formatCurrency: (value: number) => string;
  formatTime: (iso: string) => string;
  onDiscard: () => void;
  onCarry: () => void;
}) {
  const { t } = useTranslation('dayCloseGuide');
  return (
    <CloseRow
      state="todo"
      testId={`day-close-row-draft-${draft.id}`}
      title={t('drafts.pending', {
        name: draft.label ?? draft.saleNumber,
        amount: formatCurrency(draft.total),
      })}
      detail={t('drafts.detail', { time: formatTime(draft.suspendedAt) })}
      actions={
        !frozen && (
          <>
            <Button
              variant="outline"
              size="compact"
              className="rounded-full"
              disabled={busy}
              onClick={onDiscard}
              data-testid={`day-close-draft-discard-${draft.id}`}
            >
              {t('drafts.discard')}
            </Button>
            <Button
              size="compact"
              className="rounded-full"
              disabled={busy}
              onClick={onCarry}
              data-testid={`day-close-draft-carry-${draft.id}`}
            >
              {t('drafts.carry')}
            </Button>
          </>
        )
      }
    />
  );
}

export function FiscalRow({ report }: { report: CloseReport }) {
  const { t } = useTranslation('dayCloseGuide');
  const { user } = useAuth();
  const inProgress = fiscalInProgress(report);
  const rejected = report.fiscal.byStatus.rejected;
  return (
    <CloseRow
      state={inProgress > 0 || rejected > 0 ? 'info' : 'done'}
      testId="day-close-row-fiscal"
      title={[
        t('fiscal.title', { accepted: report.fiscal.byStatus.accepted, inProgress }),
        ...(rejected > 0 ? [t('fiscal.rejected', { count: rejected })] : []),
      ].join(' · ')}
      actions={
        user?.role === 'admin' && (
          <Link
            to="/fiscal-documents"
            className="text-sm font-semibold text-fg1 hover:underline"
            data-testid="day-close-fiscal-link"
          >
            {t('fiscal.view')}
          </Link>
        )
      }
    />
  );
}
