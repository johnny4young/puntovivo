import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface GuidedEmptyStateCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action: ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
}

/**
 * Compact empty-state guidance for a newly provisioned surface.
 *
 * Unlike a passive zero-state, the card always includes a clear route to the
 * prerequisite or creation task.
 */
export function GuidedEmptyStateCard({
  icon: Icon,
  title,
  description,
  action,
  className,
  testId,
}: GuidedEmptyStateCardProps): React.ReactElement {
  return (
    <aside
      className={cn(
        'flex flex-col gap-3 rounded-2xl border border-primary-100 bg-primary-50/80 px-4 py-3.5 sm:flex-row sm:items-center',
        className
      )}
      data-testid={testId}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary-700 shadow-sm">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-primary-950">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-primary-800">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </aside>
  );
}
