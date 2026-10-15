import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldErrors, FieldValues, Path, UseFormTrigger } from 'react-hook-form';

/** Re-validates fields already in error so their messages follow a language switch. */
export function useRevalidateOnLanguageChange<T extends FieldValues>(
  errors: FieldErrors<T>,
  trigger: UseFormTrigger<T>
): void {
  const { i18n } = useTranslation();
  const validationLanguage = useRef(i18n.resolvedLanguage);
  useEffect(() => {
    if (validationLanguage.current === i18n.resolvedLanguage) return;
    validationLanguage.current = i18n.resolvedLanguage;
    const invalidFields = Object.keys(errors) as Array<Path<T>>;
    if (invalidFields.length > 0) void trigger(invalidFields);
  }, [i18n.resolvedLanguage, errors, trigger]);
}
