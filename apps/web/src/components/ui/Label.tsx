import { forwardRef, type LabelHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const labelVariants = cva('text-sm font-medium leading-none', {
  variants: {
    variant: {
      default: 'text-secondary-700',
      error: 'text-danger-700',
      disabled: 'text-secondary-400 cursor-not-allowed',
      muted: 'text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement>, VariantProps<typeof labelVariants> {
  /** Mark the field as required */
  required?: boolean;
}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, variant, required, children, ...props }, ref) => {
    return (
      <label ref={ref} className={cn(labelVariants({ variant }), className)} {...props}>
        {children}
        {required && <span className="text-danger-500 ml-1">*</span>}
      </label>
    );
  }
);

Label.displayName = 'Label';

export { Label, labelVariants };
