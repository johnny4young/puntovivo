import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('pv-badge', {
  variants: {
    variant: {
      default: 'primary',
      primary: 'primary',
      secondary: 'neutral',
      neutral: 'neutral',
      info: 'info',
      success: 'success',
      warning: 'warning',
      danger: 'danger',
      outline: 'outline',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Optional shape cue for high-density tables where status must scan quickly. */
  marker?: 'none' | 'dot' | undefined;
}

/**
 * Compact operational state label. Tone always travels with visible text; the
 * optional marker accelerates scanning but never carries meaning by itself.
 */
const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, marker = 'none', children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props}>
      {marker === 'dot' && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  )
);

Badge.displayName = 'Badge';

export { Badge };
