import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type NextActionTone = 'neutral' | 'critical' | 'ready';

export interface NextActionCardProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  action: ReactNode;
  tone?: NextActionTone;
  inverse?: boolean;
  className?: string | undefined;
  testId?: string | undefined;
}

const ICON_TONE: Record<NextActionTone, { light: string; inverse: string }> = {
  neutral: {
    light: 'bg-primary-50 text-primary-800',
    inverse: 'bg-white/12 text-primary-50',
  },
  critical: {
    light: 'bg-danger-50 text-danger-700',
    inverse: 'bg-danger-400/20 text-danger-100',
  },
  ready: {
    light: 'bg-success-50 text-success-700',
    inverse: 'bg-success-400/20 text-success-100',
  },
};

/**
 * Keeps the next valid action, its reason, and its recovery control together.
 * It is deliberately presentational so features retain their domain behavior.
 */
export function NextActionCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  tone = 'neutral',
  inverse = false,
  className,
  testId,
}: NextActionCardProps): React.ReactElement {
  return (
    <section
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
      data-testid={testId}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
            inverse ? ICON_TONE[tone].inverse : ICON_TONE[tone].light
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              'text-[0.66rem] font-bold uppercase tracking-[0.18em]',
              inverse ? 'text-primary-100/75' : 'text-secondary-500'
            )}
          >
            {eyebrow}
          </p>
          <h3
            className={cn(
              'mt-1 text-lg font-semibold',
              inverse ? 'text-white' : 'text-secondary-950'
            )}
          >
            {title}
          </h3>
          <p
            className={cn(
              'mt-1 max-w-[64ch] text-sm leading-5',
              inverse ? 'text-primary-50/75' : 'text-secondary-600'
            )}
          >
            {description}
          </p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </section>
  );
}
