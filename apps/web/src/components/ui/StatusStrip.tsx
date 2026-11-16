import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusStripTone = 'info' | 'success' | 'warning' | 'danger';

export interface StatusStripProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone: StatusStripTone;
  icon?: LucideIcon | undefined;
  title: ReactNode;
  children?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}

/** Compact severity notice: tinted surface, icon tile, message and optional actions. */
export const StatusStrip = forwardRef<HTMLDivElement, StatusStripProps>(
  ({ tone, icon: Icon, title, children, meta, action, className, ...props }, ref) => (
    <div ref={ref} className={cn('pv-strip', tone, className)} {...props}>
      {Icon && (
        <span className="ic" aria-hidden="true">
          <Icon className="h-4 w-4" strokeWidth={1.7} />
        </span>
      )}
      <div className="msg">
        <strong>{title}</strong>
        {children && <div className="detail">{children}</div>}
      </div>
      {meta && <span className="meta">{meta}</span>}
      {action && <span className="act">{action}</span>}
    </div>
  )
);

StatusStrip.displayName = 'StatusStrip';
