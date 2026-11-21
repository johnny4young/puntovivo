import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { cn } from '@/lib/utils';
import { initialsOf, PIN_LENGTH } from './handoffModel';

interface HandoffFrameProps {
  isOpen: boolean;
  onClose: () => void;
  testId: string;
  personName: string | null | undefined;
  title: string;
  subtitle: string;
  headerExtra?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}

/** The relevo sheets: who and which register on top, the work in the middle, one action below. */
export function HandoffFrame({
  isOpen,
  onClose,
  testId,
  personName,
  title,
  subtitle,
  headerExtra,
  footer,
  children,
}: HandoffFrameProps) {
  const titleId = useId();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      showCloseButton={false}
      closeOnBackdrop={false}
      className="max-w-[41rem] bg-background sm:h-[min(90vh,66rem)]"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0 sm:p-0"
      footerClassName="flex-row items-center gap-3.5 bg-surface sm:justify-between"
      footer={footer}
    >
      <div data-testid={testId} className="contents">
        <header className="relative shrink-0 border-b-[1.5px] border-line bg-surface px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-primary-100 font-display text-sm font-bold text-fg1"
            >
              {initialsOf(personName)}
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="font-display text-[1.6875rem] font-bold leading-[1.1] text-fg1"
              >
                {title}
              </h2>
              <p className="truncate text-sm text-fg3">{subtitle}</p>
            </div>
          </div>
          {headerExtra}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-[18px] sm:px-6">{children}</div>
      </div>
    </Modal>
  );
}

export type HandoffStep = 1 | 2 | 3;

/** Numbered steps; a step past the last one marks every step done. */
export function HandoffStepper({
  step,
  labels,
  testId = 'handoff-stepper',
  className,
}: {
  step: number;
  labels?: string[];
  testId?: string;
  className?: string;
}) {
  const { t } = useTranslation('cashHandoffs');
  const steps = labels ?? [
    t('sheet.steps.count'),
    t('sheet.steps.handover'),
    t('sheet.steps.sign'),
  ];
  return (
    <ol className={cn('mt-3 flex flex-wrap items-center gap-1', className)} data-testid={testId}>
      {steps.map((label, index) => {
        const number = index + 1;
        const state = number < step ? 'done' : number === step ? 'now' : 'next';
        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === 'now' ? 'step' : undefined}
            className={cn(
              'flex h-9 items-center gap-[7px] rounded-[18px] pl-2 pr-[13px] text-sm font-semibold',
              state === 'now' && 'bg-fg1 text-surface',
              state === 'done' && 'text-fg1',
              state === 'next' && 'text-fg3'
            )}
          >
            {state === 'done' ? (
              <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-success-700 text-surface">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ) : (
              <span
                className={cn(
                  'inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] text-[13px] tabular-nums',
                  state === 'now' ? 'border-surface' : 'border-line-strong'
                )}
                aria-hidden="true"
              >
                {number}
              </span>
            )}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

type Tone = 'go' | 'red' | 'amber' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  go: 'bg-primary-50 text-primary-700',
  red: 'bg-danger-50 text-danger-700',
  amber: 'bg-warning-50 text-warning-700',
  neutral: 'bg-surface-3 text-fg2',
};

export function HandoffRow({
  icon,
  title,
  detail,
  tag,
  tone = 'neutral',
  action,
  testId,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  tag?: string;
  tone?: Tone;
  action?: ReactNode;
  testId: string;
}) {
  return (
    <li
      data-testid={testId}
      className="flex min-h-[62px] items-center gap-[13px] border-t-[1.5px] border-line py-2"
    >
      <span className="shrink-0 text-fg2" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16.5px] font-semibold text-fg1">{title}</p>
        {detail && <p className="text-[13.5px] text-fg3">{detail}</p>}
      </div>
      {tag && (
        <span
          className={cn(
            'inline-flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-[15px] px-[11px] text-[13px] font-bold',
            TONE_CLASS[tone]
          )}
        >
          {tag}
        </span>
      )}
      {action}
    </li>
  );
}

export function HandoffCap({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="sales-cap mb-2 mt-[18px] text-fg3">
      {children}
    </h3>
  );
}

/** Six dots over a numeric field: what the cashier types is never shown. */
export function PinField({
  value,
  onChange,
  label,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  invalid?: boolean;
}) {
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] text-fg3">
        {label}
      </label>
      <div className="relative inline-flex h-9 items-center gap-[9px] rounded-lg px-1 focus-within:ring-2 focus-within:ring-primary-400/50">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              'h-[18px] w-[18px] rounded-full border-2',
              invalid ? 'border-danger-700' : 'border-fg1',
              index < value.length && (invalid ? 'bg-danger-700' : 'bg-fg1')
            )}
          />
        ))}
        <input
          id={inputId}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          data-testid="handoff-pin"
          aria-invalid={invalid || undefined}
          className="absolute inset-0 h-full w-full cursor-text opacity-0"
          value={value}
          onChange={event => onChange(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
        />
      </div>
    </div>
  );
}

export function ToggleChip({
  pressed,
  onClick,
  label,
  testId,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'btn-outline h-11 shrink-0 rounded-xl px-3.5 text-[14.5px]',
        pressed && 'border-fg1 bg-fg1 text-surface hover:bg-fg1'
      )}
    >
      {pressed && <Check className="h-4 w-4" aria-hidden="true" />}
      {label}
    </button>
  );
}
