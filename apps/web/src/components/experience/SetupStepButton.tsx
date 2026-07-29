import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type SetupStepTone = 'ready' | 'critical' | 'warning' | 'neutral' | 'muted';

export interface SetupStepButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  index: string;
  title: string;
  statusLabel: string;
  tone: SetupStepTone;
  active?: boolean;
  status?: string | undefined;
}

const STEP_TONE_CLASSES: Record<SetupStepTone, string> = {
  ready: 'border-success-200 bg-success-50/65 text-success-800',
  critical: 'border-danger-200 bg-danger-50/70 text-danger-800',
  warning: 'border-warning-200 bg-warning-50/70 text-warning-800',
  neutral: 'border-secondary-200 bg-secondary-50/80 text-secondary-700',
  muted: 'border-secondary-200 bg-white text-secondary-500',
};

/** A numbered, keyboard-operable step with status conveyed by text and color. */
export function SetupStepButton({
  icon: Icon,
  index,
  title,
  statusLabel,
  tone,
  active = false,
  status,
  className,
  type = 'button',
  ...props
}: SetupStepButtonProps): React.ReactElement {
  return (
    <button
      type={type}
      className={cn(
        'group flex min-h-28 flex-col items-start rounded-2xl border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5',
        active
          ? 'border-primary-300 bg-primary-50/80 shadow-[0_12px_28px_-22px_rgba(2,96,144,0.8)]'
          : 'border-transparent bg-surface-2/65 hover:border-line hover:bg-white',
        className
      )}
      aria-current={active ? 'step' : undefined}
      data-status={status}
      {...props}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            'grid h-9 w-9 place-items-center rounded-xl border',
            STEP_TONE_CLASSES[tone]
          )}
        >
          <Icon className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
        </span>
        <span className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-secondary-700">
          {index}
        </span>
      </span>
      <span className="mt-3 text-sm font-semibold text-secondary-950">{title}</span>
      <span className="mt-1 text-xs leading-4 text-secondary-500">{statusLabel}</span>
    </button>
  );
}
