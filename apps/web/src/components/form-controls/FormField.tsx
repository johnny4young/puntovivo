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
        <div className={cn('pv-field', className)}>
          {label && (
            <label htmlFor={name} className="label">
              {label}
              {required && <span className="req">*</span>}
            </label>
          )}

          {isValidElement(children)
            ? // Omit `label` from the cloned props instead of
              // passing `label: undefined`. Under exactOptionalPropertyTypes
              // an explicit `undefined` is NOT assignable to an optional
              // `label?: string` prop on the child; the previous code hid that
              // by smuggling `label: undefined` inside the cast. The label is
              // already rendered above, and `field` carries no `label` key, so
              // building the props without one is the omit. The cast remains
              // only because `children` is an untyped `ReactElement` (the
              // FormField clones an arbitrary control — Input, Select, etc.),
              // so `cloneElement` cannot statically know the child's prop bag.
              cloneElement(children, {
                ...field,
                id: name,
                error: error?.message,
              } as Record<string, unknown>)
            : children}

          {helperText && !error && <p className="help">{helperText}</p>}

          {error && (
            <p className="err-msg" role="alert">
              {error.message}
            </p>
          )}
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
    <div className={cn('pv-field', className)}>
      {label && (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required && <span className="req">*</span>}
        </label>
      )}

      {children}

      {helperText && !hasError && <p className="help">{helperText}</p>}

      {hasError && (
        <p className="err-msg" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
