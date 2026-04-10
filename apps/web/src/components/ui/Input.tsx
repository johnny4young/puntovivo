import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  [
    'w-full rounded-2xl border px-3.5 py-2.5 text-sm transition-all duration-200',
    'placeholder:text-secondary-400',
    'focus:outline-none focus:ring-4 focus:ring-offset-0',
  ],
  {
    variants: {
      variant: {
        default: [
          'border-line-strong/65 bg-surface/95',
          'focus:border-primary-400 focus:bg-white focus:ring-primary-100/60',
          'hover:border-primary-200',
        ],
        error: ['border-danger-500 bg-white', 'focus:border-danger-500 focus:ring-danger-500/15'],
      },
      inputSize: {
        default: 'h-11',
        sm: 'h-9 text-xs',
        lg: 'h-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      inputSize: 'default',
    },
  }
);

export interface InputProps
  extends
    Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'>,
    VariantProps<typeof inputVariants> {
  /** Input label */
  label?: string;
  /** Error message to display */
  error?: string;
  /** Helper text below the input */
  helperText?: string;
  /** Icon or element to show before the input */
  prefix?: ReactNode;
  /** Icon or element to show after the input */
  suffix?: ReactNode;
  /** Additional wrapper class */
  wrapperClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      type = 'text',
      label,
      error,
      helperText,
      prefix,
      suffix,
      disabled,
      readOnly,
      className,
      wrapperClassName,
      id,
      variant,
      inputSize,
      ...props
    },
    ref
  ) => {
    const inputId = id || props.name;
    const hasError = !!error;
    const computedVariant = hasError ? 'error' : variant;

    return (
      <div className={cn('w-full', wrapperClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'block text-sm font-medium mb-1.5',
              hasError ? 'text-danger-700' : 'text-secondary-700',
              disabled && 'text-secondary-400'
            )}
          >
            {label}
          </label>
        )}

        <div className="relative">
          {prefix && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400 pointer-events-none">
              {prefix}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            type={type}
            disabled={disabled}
            readOnly={readOnly}
            className={cn(
              inputVariants({ variant: computedVariant, inputSize }),
              // Disabled state
              disabled && [
                'bg-secondary-100 border-line',
                'text-secondary-400 cursor-not-allowed',
              ],
              // Readonly state
              readOnly && ['bg-secondary-50 border-line', 'focus:ring-0 cursor-default'],
              // Padding adjustments for icons
              prefix && 'pl-10',
              suffix && 'pr-10',
              className
            )}
            aria-invalid={hasError}
            aria-describedby={
              hasError ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
            }
            {...props}
          />

          {suffix && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary-400">
              {suffix}
            </div>
          )}
        </div>

        {hasError && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger-600" role="alert">
            {error}
          </p>
        )}

        {!hasError && helperText && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-sm text-secondary-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export { Input, inputVariants };
