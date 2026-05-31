import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MonitorCog, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/components/feedback/ThemeProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}

export function CompanyThemeSettingsCard() {
  const { t } = useTranslation('settings');
  const { preference, resolvedTheme, isLoading, setPreference } = useTheme();
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electron);

  const themeOptions: ThemeOption[] = [
    {
      value: 'light',
      label: t('company.theme.options.light.label'),
      description: t('company.theme.options.light.description'),
      icon: Sun,
    },
    {
      value: 'dark',
      label: t('company.theme.options.dark.label'),
      description: t('company.theme.options.dark.description'),
      icon: Moon,
    },
    {
      value: 'system',
      label: t('company.theme.options.system.label'),
      description: t('company.theme.options.system.description'),
      icon: MonitorCog,
    },
  ];

  const handleSelect = async (nextPreference: ThemePreference) => {
    if (nextPreference === preference || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await setPreference(nextPreference);
      toast.success({
        title: t('company.theme.toast.updated'),
        description:
          nextPreference === 'system'
            ? t('company.theme.toast.systemDescription')
            : t('company.theme.toast.themeDescription', { theme: nextPreference }),
      });
    } catch (error) {
      toast.error({
        title: t('company.theme.toast.updateError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start gap-3">
        <span className="pv-gt pv-gt-ink flex h-10 w-10 flex-shrink-0 items-center justify-center">
          <MonitorCog className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="pv-title text-lg">{t('company.theme.title')}</h2>
          <p className="mt-1 text-sm text-fg3">{t('company.theme.description')}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {themeOptions.map(option => {
          const Icon = option.icon;
          const isSelected = option.value === preference;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              className={`pv-check flex w-full items-center rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected
                  ? 'border-primary-400 bg-primary-50'
                  : 'border-line hover:border-primary-200'
              }`}
              onClick={() => {
                void handleSelect(option.value);
              }}
              disabled={isLoading || isSaving}
            >
              <span className={`ic ${isSelected ? 'bg-primary-50 text-primary-700' : 'opt'}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="grow">
                <span className="t block">{option.label}</span>
                <span className="d block">{option.description}</span>
              </span>
              <span
                className={`h-4 w-4 flex-shrink-0 rounded-full ${
                  isSelected ? 'border-[5px] border-primary' : 'border-[1.5px] border-line-strong'
                }`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>

      {!isDesktop && <p className="mt-3 text-xs text-fg3">{t('company.theme.browserNote')}</p>}

      <p className="mt-4 text-sm text-fg3">
        {t('company.theme.activeAppearance')}{' '}
        <span className="font-medium capitalize text-fg1">{resolvedTheme}</span>
      </p>
    </section>
  );
}
