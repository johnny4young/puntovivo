import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
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

export const Input = forwardRef<HTMLInputElement, InputProps>(
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
      ...props
    },
    ref
  ) => {
    const inputId = id || props.name;
    const hasError = !!error;

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
              'w-full rounded-lg border px-3 py-2 text-sm transition-colors',
              'placeholder:text-secondary-400',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              // Default state
              !hasError &&
                !disabled && [
                  'border-secondary-300',
                  'focus:border-primary-500 focus:ring-primary-500/20',
                  'hover:border-secondary-400',
                ],
              // Error state
              hasError && ['border-danger-500', 'focus:border-danger-500 focus:ring-danger-500/20'],
              // Disabled state
              disabled && [
                'bg-secondary-100 border-secondary-200',
                'text-secondary-400 cursor-not-allowed',
              ],
              // Readonly state
              readOnly && ['bg-secondary-50 border-secondary-200', 'focus:ring-0 cursor-default'],
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

        {error && (
          <p id={`${inputId}-error`} className="mt-1.5 text-sm text-danger-600">
            {error}
          </p>
        )}

        {helperText && !error && (
          <p id={`${inputId}-helper`} className="mt-1.5 text-sm text-secondary-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
