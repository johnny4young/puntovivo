import { useState } from 'react';
import { MonitorCog, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/components/feedback/ThemeProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { getErrorMessage } from '@/lib/utils';

interface ThemeOption {
  value: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}

const themeOptions: ThemeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Use the light interface across the workstation.',
    icon: Sun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Use the dark interface across the workstation.',
    icon: Moon,
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow the operating system appearance preference.',
    icon: MonitorCog,
  },
];

export function CompanyThemeSettingsCard() {
  const { preference, resolvedTheme, isLoading, setPreference } = useTheme();
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const isDesktop = typeof window !== 'undefined' && Boolean(window.electron);

  const handleSelect = async (nextPreference: ThemePreference) => {
    if (nextPreference === preference || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await setPreference(nextPreference);
      toast.success({
        title: 'Theme updated',
        description:
          nextPreference === 'system'
            ? 'The app now follows the system appearance.'
            : `The app is now using the ${nextPreference} theme.`,
      });
    } catch (error) {
      toast.error({
        title: 'Unable to update theme',
        description: getErrorMessage(error, 'Unable to update theme'),
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
          <h2 className="text-lg font-semibold text-secondary-900">Appearance</h2>
          <p className="text-sm text-secondary-500">
            Control the workstation theme and whether it follows the operating system.
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          Browser sessions store the theme preference locally in this device.
        </div>
      )}

      <div className="space-y-3">
        {themeOptions.map(option => {
          const Icon = option.icon;
          const isSelected = option.value === preference;

          return (
            <button
              key={option.value}
              type="button"
              className={`flex w-full items-start justify-between gap-4 rounded-xl border px-4 py-4 text-left transition ${
                isSelected
                  ? 'border-primary-300 bg-primary-50'
                  : 'border-secondary-200 bg-white hover:border-secondary-300'
              }`}
              onClick={() => {
                void handleSelect(option.value);
              }}
              disabled={isLoading || isSaving}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg ${
                    isSelected ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-600'
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
                  isSelected ? 'border-primary-600 bg-primary-600' : 'border-secondary-300 bg-white'
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
        Active appearance: <span className="font-medium capitalize text-secondary-700">{resolvedTheme}</span>
      </p>
    </section>
  );
}
