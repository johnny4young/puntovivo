import { useId, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface AdvancedDisclosureProps {
  icon: LucideIcon;
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  status?: string | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
  testId?: string | undefined;
}

/**
 * Keeps secondary form decisions available without making them part of the
 * default task path. The feature owns the open state so validation can reveal
 * a hidden field when it needs the operator's attention.
 */
export function AdvancedDisclosure({
  icon: Icon,
  title,
  description,
  open,
  onOpenChange,
  children,
  status,
  className,
  contentClassName,
  testId,
}: AdvancedDisclosureProps): React.ReactElement {
  const contentId = useId();

  return (
    <section
      className={cn(
        'overflow-hidden rounded-[1.35rem] border border-line bg-card shadow-[0_18px_50px_-42px_rgba(15,23,42,0.55)]',
        className
      )}
      data-testid={testId}
    >
      <button
        type="button"
        className="flex min-h-14 w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-secondary-200 bg-surface-2 text-secondary-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold leading-tight text-secondary-950">{title}</span>
            {status ? (
              <span className="rounded-full border border-secondary-200 bg-surface px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-secondary-600">
                {status}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block max-w-[64ch] text-sm leading-5 text-secondary-600">
            {description}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'mt-2 h-5 w-5 shrink-0 text-secondary-500 transition-transform',
            open && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>
      <div
        id={contentId}
        className={cn('grid gap-4 border-t border-line/80 bg-surface-2/35 p-4', contentClassName)}
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
}
