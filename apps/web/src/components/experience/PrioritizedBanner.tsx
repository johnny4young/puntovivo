import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type PrioritizedBannerTone = 'neutral' | 'ready' | 'warning' | 'critical';
export type PrioritizedBannerDensity = 'regular' | 'compact';

export interface PrioritizedBannerProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  tone?: PrioritizedBannerTone;
  density?: PrioritizedBannerDensity;
  meta?: ReactNode;
  action?: ReactNode;
  details?: ReactNode;
  metaClassName?: string | undefined;
  actionClassName?: string | undefined;
  testId?: string | undefined;
}

const SURFACE_TONE: Record<PrioritizedBannerTone, string> = {
  neutral:
    'border-primary-100 bg-[linear-gradient(100deg,rgba(14,165,233,0.07),transparent_34%),var(--surface)] shadow-[inset_4px_0_0_var(--primary-700),0_18px_42px_-38px_rgba(15,23,42,0.62)]',
  ready:
    'border-success-200 bg-[linear-gradient(100deg,rgba(38,173,122,0.1),transparent_34%),var(--surface)] shadow-[inset_4px_0_0_var(--success-600),0_18px_42px_-38px_rgba(15,23,42,0.62)]',
  warning:
    'border-warning-200 bg-[linear-gradient(100deg,rgba(245,158,11,0.11),transparent_38%),var(--surface)] shadow-[inset_4px_0_0_var(--warning-600),0_18px_42px_-38px_rgba(15,23,42,0.62)]',
  critical:
    'border-danger-200 bg-[linear-gradient(100deg,rgba(220,38,38,0.09),transparent_38%),var(--surface)] shadow-[inset_4px_0_0_var(--danger-600),0_18px_42px_-38px_rgba(15,23,42,0.62)]',
};

const ICON_TONE: Record<PrioritizedBannerTone, string> = {
  neutral: 'border-primary-100 bg-primary-50 text-primary-800',
  ready: 'border-success-200 bg-success-50 text-success-800',
  warning: 'border-warning-200 bg-warning-50 text-warning-800',
  critical: 'border-danger-200 bg-danger-50 text-danger-800',
};

/**
 * Presents the single highest-priority condition and its next valid action.
 *
 * Domain code still decides what wins. The primitive owns the visible
 * hierarchy, semantic tone, responsive layout, and optional secondary detail.
 */
export function PrioritizedBanner({
  icon: Icon,
  eyebrow,
  title,
  description,
  tone = 'neutral',
  density = 'regular',
  meta,
  action,
  details,
  metaClassName,
  actionClassName,
  className,
  testId,
  ...props
}: PrioritizedBannerProps): React.ReactElement {
  return (
    <section
      className={cn(
        '@container relative shrink-0 overflow-hidden border',
        density === 'compact'
          ? 'rounded-2xl px-4 py-3'
          : 'rounded-[1.5rem] p-4 sm:p-5',
        SURFACE_TONE[tone],
        className
      )}
      data-testid={testId}
      {...props}
    >
      <div
        className={cn(
          'grid',
          density === 'compact'
            ? 'gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center @2xl:grid-cols-[minmax(0,1fr)_auto_minmax(10rem,auto)]'
            : 'gap-4 @3xl:grid-cols-[minmax(0,1fr)_auto_auto] @3xl:items-center'
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-xl border',
              density === 'compact' ? 'h-9 w-9' : 'h-11 w-11',
              ICON_TONE[tone]
            )}
          >
            <Icon
              className={density === 'compact' ? 'h-[1.05rem] w-[1.05rem]' : 'h-5 w-5'}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0">
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-primary-800">
              {eyebrow}
            </p>
            <h3
              className={cn(
                'mt-1 font-semibold leading-tight text-secondary-950',
                density === 'compact' ? 'text-[0.94rem]' : 'text-lg'
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                'mt-1 max-w-[64ch] text-secondary-600',
                density === 'compact'
                  ? 'text-xs leading-[1.4] @xl:truncate'
                  : 'text-sm leading-5'
              )}
            >
              {description}
            </p>
          </div>
        </div>

        {meta && <div className={cn('min-w-0', metaClassName)}>{meta}</div>}
        {action && (
          <div
            className={cn(
              'min-w-0',
              density === 'compact' ? '@xl:justify-self-end' : '@3xl:justify-self-end',
              actionClassName
            )}
          >
            {action}
          </div>
        )}
        {details && (
          <div
            className={cn(
              'border-t border-secondary-200/70 pt-2.5',
              density === 'compact'
                ? '@xl:col-span-2 @2xl:col-span-3'
                : '@3xl:col-span-3'
            )}
          >
            {details}
          </div>
        )}
      </div>
    </section>
  );
}
