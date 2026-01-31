import { type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
  type RegisterOptions,
} from 'react-hook-form';
import { cn } from '@/lib/utils';

export interface FormFieldProps<TFieldValues extends FieldValues = FieldValues> {
  /** Field name for react-hook-form */
  name: Path<TFieldValues>;
  /** react-hook-form control object */
  control: Control<TFieldValues>;
  /** Field label */
  label?: string;
  /** Show required indicator (*) */
  required?: boolean;
  /** Helper text displayed below the input */
  helperText?: string;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions<TFieldValues>;
  /** Additional wrapper class */
  className?: string;
  /** Child component (Input, Select, etc.) */
  children: ReactElement;
}

export function FormField<TFieldValues extends FieldValues = FieldValues>({
  name,
  control,
  label,
  required = false,
  helperText,
  rules,
  className,
  children,
}: FormFieldProps<TFieldValues>) {
  return (
    <Controller
      name={name}
      control={control}
      rules={{
        required: required ? 'This field is required' : false,
        ...rules,
      }}
      render={({ field, fieldState: { error } }) => (
        <div className={cn('w-full', className)}>
          {label && (
            <label
              htmlFor={name}
              className={cn(
                'block text-sm font-medium mb-1.5',
                error ? 'text-danger-700' : 'text-secondary-700'
              )}
            >
              {label}
              {required && <span className="text-danger-500 ml-0.5">*</span>}
            </label>
          )}

          {isValidElement(children)
            ? cloneElement(children, {
                ...field,
                id: name,
                error: error?.message,
                // Don't pass label again since we handle it here
                label: undefined,
              } as Record<string, unknown>)
            : children}

          {helperText && !error && (
            <p className="mt-1.5 text-sm text-secondary-500">{helperText}</p>
          )}

          {error && <p className="mt-1.5 text-sm text-danger-600">{error.message}</p>}
        </div>
      )}
    />
  );
}

// Simpler version without Controller for uncontrolled forms
export interface SimpleFormFieldProps {
  /** Field label */
  label?: string;
  /** Show required indicator (*) */
  required?: boolean;
  /** Error message */
  error?: string;
  /** Helper text */
  helperText?: string;
  /** Children (the form control) */
  children: ReactNode;
  /** Wrapper class */
  className?: string;
  /** HTML for attribute */
  htmlFor?: string;
}

export function SimpleFormField({
  label,
  required = false,
  error,
  helperText,
  children,
  className,
  htmlFor,
}: SimpleFormFieldProps) {
  const hasError = !!error;

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className={cn(
            'block text-sm font-medium mb-1.5',
            hasError ? 'text-danger-700' : 'text-secondary-700'
          )}
        >
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </label>
      )}

      {children}

      {helperText && !error && <p className="mt-1.5 text-sm text-secondary-500">{helperText}</p>}

      {error && <p className="mt-1.5 text-sm text-danger-600">{error}</p>}
    </div>
  );
}
