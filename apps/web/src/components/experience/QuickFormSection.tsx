import { useId, type HTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface QuickFormSectionProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
  icon: LucideIcon;
  eyebrow?: string | undefined;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  headingLevel?: 3 | 4;
  contentClassName?: string | undefined;
  testId?: string | undefined;
}

/**
 * Groups the minimum fields required to finish one short form task.
 *
 * The feature owns validation and submission. This primitive keeps the task
 * label, short explanation, fields, and optional footer in one calm surface.
 */
export function QuickFormSection({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
  footer,
  headingLevel = 3,
  contentClassName,
  className,
  testId,
  ...props
}: QuickFormSectionProps): React.ReactElement {
  const titleId = useId();
  const Heading = headingLevel === 4 ? 'h4' : 'h3';

  return (
    <section
      className={cn(
        'overflow-hidden rounded-[1.35rem] border border-line bg-card shadow-[0_18px_50px_-42px_rgba(15,23,42,0.55)]',
        className
      )}
      aria-labelledby={titleId}
      data-testid={testId}
      {...props}
    >
      <div className="flex items-start gap-3 border-b border-line/80 bg-surface-2/55 px-4 py-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary-100 bg-white text-primary-800 shadow-sm">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[0.62rem] font-bold uppercase tracking-[0.18em] text-primary-800">
              {eyebrow}
            </p>
          )}
          <Heading
            id={titleId}
            className={cn(
              'font-semibold leading-tight text-secondary-950',
              eyebrow ? 'mt-1' : 'mt-0.5',
              headingLevel === 4 ? 'text-base' : 'text-lg'
            )}
          >
            {title}
          </Heading>
          <p className="mt-1 max-w-[64ch] text-sm leading-5 text-secondary-600">
            {description}
          </p>
        </div>
      </div>
      <div className={cn('grid gap-4 p-4', contentClassName)}>{children}</div>
      {footer && <div className="border-t border-line/80 bg-surface-2/40 px-4 py-3">{footer}</div>}
    </section>
  );
}
