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
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-100">
          <MonitorCog className="h-5 w-5 text-secondary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">{t('company.theme.title')}</h2>
          <p className="text-sm text-secondary-500">
            {t('company.theme.description')}
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="surface-panel-muted text-sm text-secondary-600">{t('company.theme.browserNote')}</div>
      )}

      <div className="space-y-3">
        {themeOptions.map(option => {
          const Icon = option.icon;
          const isSelected = option.value === preference;

          return (
            <button
              key={option.value}
              type="button"
              className={`setting-toggle-card w-full text-left ${isSelected ? 'setting-toggle-card-active' : ''}`}
              onClick={() => {
                void handleSelect(option.value);
              }}
              disabled={isLoading || isSaving}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
                    isSelected ? 'bg-primary-100 text-primary-700' : 'bg-surface-2 text-secondary-600'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-secondary-900">{option.label}</p>
                  <p className="mt-1 text-sm text-secondary-500">{option.description}</p>
                </div>
              </div>
              <span
                className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                  isSelected ? 'border-primary-600 bg-primary-600' : 'border-line-strong bg-surface'
                }`}
                aria-hidden="true"
              >
                {isSelected ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-secondary-500">
        {t('company.theme.activeAppearance')} <span className="font-medium capitalize text-secondary-700">{resolvedTheme}</span>
      </p>
    </section>
  );
}
