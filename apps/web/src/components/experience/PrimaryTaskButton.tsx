import { forwardRef } from 'react';

import { Button, type ButtonProps } from '@/components/ui';
import { cn } from '@/lib/utils';

export type PrimaryTaskButtonProps = Omit<ButtonProps, 'variant'>;

/**
 * The single dominant action in a task context.
 *
 * The wrapper intentionally fixes the semantic hierarchy and minimum target
 * size while leaving labels, icons, pending state, and business behavior to
 * the calling feature.
 */
export const PrimaryTaskButton = forwardRef<HTMLButtonElement, PrimaryTaskButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="primary"
      className={cn('min-h-11 gap-2', className)}
      {...props}
    />
  )
);

PrimaryTaskButton.displayName = 'PrimaryTaskButton';
