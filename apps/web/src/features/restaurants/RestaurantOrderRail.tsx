import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { modifierSummary, type RailLine, type SentRound } from './orderRounds';

function SeatTag({ seat }: { seat: number | null }) {
  const { t } = useTranslation('restaurants');
  return (
    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-fg2">
      {seat === null ? t('rail.sharedTag') : t('rail.dinerTag', { count: seat })}
    </span>
  );
}

function LineBody({ line }: { line: RailLine }) {
  const { t } = useTranslation('restaurants');
  const details = [modifierSummary(t, line.modifiers), line.note].filter(Boolean).join(' · ');
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-fg1">{line.productName}</span>
        <SeatTag seat={line.seatNumber} />
      </span>
      {details && <span className="mt-0.5 block text-xs text-fg3">{details}</span>}
    </span>
  );
}

/** Order rail: sent rounds, the round being built, the table total and the send action. */
export function RestaurantOrderRail({
  sentRounds,
  draftLines,
  tableTotal,
  sendLabel,
  sendDisabled,
  interactionDisabled,
  sticky,
  hints,
  onEdit,
  onRemove,
  onSend,
}: {
  sentRounds: SentRound[];
  draftLines: RailLine[];
  tableTotal: number;
  sendLabel: string;
  sendDisabled: boolean;
  interactionDisabled: boolean;
  /** Phones keep the total and the send action in thumb reach. */
  sticky: boolean;
  hints?: ReactNode;
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
  onSend: () => void;
}) {
  const { t, i18n } = useTranslation('restaurants');
  const time = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }),
    [i18n.language]
  );
  const roundHeading = 'flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em]';

  return (
    <section
      aria-label={t('rail.label')}
      className="flex h-full min-h-0 flex-col"
      data-testid="order-rail"
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pt-5">
        {sentRounds.map(round => (
          <div key={round.key} data-testid="order-rail-sent-round">
            <h3 className={`${roundHeading} text-success-700`}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {t('rail.sentRound', {
                count: round.sequence,
                time: time.format(new Date(round.sentAt)),
              })}
              {round.checkLabel && (
                <span className="truncate font-semibold normal-case tracking-normal text-fg3">
                  {round.checkLabel}
                </span>
              )}
            </h3>
            <ul className="mt-1 divide-y divide-line/60">
              {round.lines.map(line => (
                <li key={line.key} className="flex items-start gap-3 py-2.5 text-[0.9375rem]">
                  <span className="w-6 shrink-0 font-semibold tabular-nums text-fg1">
                    {line.quantity}
                  </span>
                  <LineBody line={line} />
                  <span className="shrink-0 font-semibold tabular-nums text-fg1">
                    {formatCurrency(line.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div data-testid="order-rail-draft-round">
          <h3 className={`${roundHeading} text-brand-accent-700`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-cobrar" />
            {t('rail.draftRound', { count: sentRounds.length + 1 })}
          </h3>
          {draftLines.length === 0 ? (
            <p className="py-6 text-sm text-fg3" data-testid="voice-ordering-cart-empty">
              {t('cart.empty')}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-line/60">
              {draftLines.map(line => (
                <li
                  key={line.key}
                  className="flex items-start gap-2 py-1.5 text-[0.9375rem]"
                  data-testid="voice-ordering-cart-row"
                >
                  <span className="w-6 shrink-0 pt-1 font-semibold tabular-nums text-fg1">
                    {line.quantity}
                  </span>
                  <button
                    type="button"
                    className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-1 text-left hover:bg-surface-2 disabled:cursor-not-allowed"
                    disabled={interactionDisabled}
                    aria-label={t('rail.editLine', { name: line.productName })}
                    onClick={() => onEdit(line.key)}
                    data-testid="order-rail-edit-line"
                  >
                    <LineBody line={line} />
                    <span className="shrink-0 font-semibold tabular-nums text-fg1">
                      {formatCurrency(line.total)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-icon h-11 w-11 shrink-0 text-fg3 hover:text-danger-600"
                    aria-label={t('cart.removeRow')}
                    disabled={interactionDisabled}
                    onClick={() => onRemove(line.key)}
                    data-testid="voice-ordering-remove-row"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <footer
        className={`space-y-3 border-t border-line bg-surface px-5 py-4 ${sticky ? 'sticky bottom-0 z-10' : ''}`}
      >
        <div className="flex items-end justify-between gap-3">
          <span className="pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-fg3">
            {t('rail.tableTotal')}
          </span>
          <span
            className="font-display text-4xl font-extrabold tabular-nums text-fg1"
            data-testid="order-rail-total"
          >
            {formatCurrency(tableTotal)}
          </span>
        </div>
        <button
          type="button"
          className="btn-charge min-h-14 w-full text-xl"
          onClick={onSend}
          disabled={sendDisabled}
          data-testid="voice-ordering-save"
        >
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
          {sendLabel}
        </button>
        {hints}
      </footer>
    </section>
  );
}
