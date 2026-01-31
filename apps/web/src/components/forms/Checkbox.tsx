import { forwardRef, type InputHTMLAttributes, useEffect, useRef } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Checkbox label */
  label?: string;
  /** Description text below the label */
  description?: string;
  /** Indeterminate state (for "select all" scenarios) */
  indeterminate?: boolean;
  /** Error message */
  error?: string;
  /** Wrapper class name */
  wrapperClassName?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      description,
      indeterminate = false,
      error,
      disabled,
      checked,
      className,
      wrapperClassName,
      id,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLInputElement | null>(null);
    const checkboxId = id || props.name;
    const hasError = !!error;

    // Handle indeterminate state (can't be set via attribute)
    useEffect(() => {
      const checkbox = internalRef.current;
      if (checkbox) {
        checkbox.indeterminate = indeterminate;
      }
    }, [indeterminate]);

    // Merge refs
    const setRefs = (element: HTMLInputElement | null) => {
      internalRef.current = element;
      if (typeof ref === 'function') {
        ref(element);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLInputElement | null>).current = element;
      }
    };

    return (
      <div className={cn('flex items-start', wrapperClassName)}>
        <div className="flex items-center h-5">
          <div className="relative">
            <input
              ref={setRefs}
              type="checkbox"
              id={checkboxId}
              checked={checked}
              disabled={disabled}
              className={cn(
                'peer sr-only',
                className
              )}
              aria-invalid={hasError}
              {...props}
            />

            <div
              className={cn(
                'h-5 w-5 rounded border-2 transition-colors cursor-pointer',
                'flex items-center justify-center',
                // Default unchecked state
                !checked && !indeterminate && !disabled && [
                  'border-secondary-300 bg-white',
                  'peer-hover:border-secondary-400',
                  'peer-focus:ring-2 peer-focus:ring-primary-500/20 peer-focus:border-primary-500',
                ],
                // Checked or indeterminate state
                (checked || indeterminate) && !disabled && [
                  'border-primary-600 bg-primary-600',
                  'peer-focus:ring-2 peer-focus:ring-primary-500/20',
                ],
                // Disabled state
                disabled && !checked && !indeterminate && [
                  'border-secondary-200 bg-secondary-100 cursor-not-allowed',
                ],
                disabled && (checked || indeterminate) && [
                  'border-secondary-300 bg-secondary-300 cursor-not-allowed',
                ],
                // Error state
                hasError && !checked && !indeterminate && [
                  'border-danger-500',
                ],
                hasError && (checked || indeterminate) && [
                  'border-danger-600 bg-danger-600',
                ]
              )}
              onClick={() => {
                if (!disabled && internalRef.current) {
                  internalRef.current.click();
                }
              }}
            >
              {checked && !indeterminate && (
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              )}
              {indeterminate && (
                <Minus className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              )}
            </div>
          </div>
        </div>

        {(label || description) && (
          <div className="ml-3">
            {label && (
              <label
                htmlFor={checkboxId}
                className={cn(
                  'text-sm font-medium cursor-pointer select-none',
                  disabled ? 'text-secondary-400 cursor-not-allowed' : 'text-secondary-700',
                  hasError && 'text-danger-700'
                )}
              >
                {label}
              </label>
            )}
            {description && (
              <p className={cn(
                'text-sm',
                disabled ? 'text-secondary-400' : 'text-secondary-500'
              )}>
                {description}
              </p>
            )}
          </div>
        )}

        {error && !label && !description && (
          <p className="ml-3 text-sm text-danger-600">{error}</p>
        )}
      </div>
    );
  }
);

Checkbox.displayName = 'Checkbox';
