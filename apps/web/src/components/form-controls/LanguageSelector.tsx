import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select';
import {
  persistLanguagePreference,
  readLanguagePreference,
  resolveBootLocale,
} from '@/i18n/resolveLocale';

/** Shares the workstation language choice before and after authentication. */
export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation('common');
  const [preference, setPreference] = useState(readLanguagePreference);

  return (
    <Select
      name="language"
      {...(compact ? {} : { label: t('language.label') })}
      options={[
        { value: 'system', label: t('language.options.system') },
        { value: 'es', label: t('language.options.es') },
        { value: 'en', label: t('language.options.en') },
      ]}
      value={preference}
      onChange={value => {
        if (value !== 'system' && value !== 'es' && value !== 'en') return;
        persistLanguagePreference(value);
        setPreference(value);
        void i18n.changeLanguage(resolveBootLocale());
      }}
      placeholder={t('language.placeholder')}
      className={
        compact
          ? 'pv-control-select h-10 border-line/70 bg-surface-2/70 px-3 text-[12.5px]'
          : 'min-w-36'
      }
    />
  );
}
