import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { SetupStepTone } from './SetupStepButton';

export interface ExpertDetailPanelProps {
  icon: LucideIcon;
  eyebrow?: string | undefined;
  title: string;
  description: string;
  action: ReactNode;
  tone?: SetupStepTone;
  variant?: 'surface' | 'outline';
  layout?: 'responsive' | 'stacked';
  className?: string | undefined;
  testId?: string | undefined;
}

const DETAIL_TONE_CLASSES: Record<SetupStepTone, string> = {
  ready: 'border-success-200 bg-success-50/65 text-success-800',
  critical: 'border-danger-200 bg-danger-50/70 text-danger-800',
  warning: 'border-warning-200 bg-warning-50/70 text-warning-800',
  neutral: 'border-secondary-200 bg-secondary-50/80 text-secondary-700',
  muted: 'border-secondary-200 bg-white text-secondary-500',
};

/**
 * A secondary detail surface that explains why and keeps its action visually
 * separate from the dominant task.
 */
export function ExpertDetailPanel({
  icon: Icon,
  eyebrow,
  title,
  description,
  action,
  tone = 'neutral',
  variant = 'surface',
  layout = 'responsive',
  className,
  testId,
}: ExpertDetailPanelProps): React.ReactElement {
  return (
    <section
      className={cn(
        'grid gap-4 rounded-[1.5rem] p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:p-5',
        layout === 'responsive' &&
          'xl:grid-cols-[auto_minmax(0,1fr)_auto] xl:items-center',
        variant === 'surface'
          ? 'border border-line bg-surface-2/55'
          : 'border border-dashed border-secondary-300 bg-transparent',
        className
      )}
      data-testid={testId}
    >
      <span
        className={cn(
          'grid h-12 w-12 place-items-center rounded-2xl border',
          DETAIL_TONE_CLASSES[tone]
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[0.66rem] font-bold uppercase tracking-[0.17em] text-secondary-500">
            {eyebrow}
          </p>
        )}
        <h3
          className={cn(
            'font-display text-xl leading-tight text-secondary-950',
            eyebrow && 'mt-1'
          )}
        >
          {title}
        </h3>
        <p className="mt-1.5 max-w-[64ch] text-sm leading-6 text-secondary-600">
          {description}
        </p>
      </div>
      <div
        className={cn(
          'w-full sm:col-span-2',
          layout === 'responsive' && 'xl:col-span-1 xl:w-auto'
        )}
      >
        {action}
      </div>
    </section>
  );
}
