import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { getErrorMessage } from '@/lib/utils';

interface TraySettings {
  enabled: boolean;
  closeToTray: boolean;
}

const defaultTraySettings: TraySettings = {
  enabled: true,
  closeToTray: false,
};

const traySettingsQueryKey = ['desktop', 'tray-settings'] as const;

interface TraySettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function TraySettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: TraySettingToggleProps) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-xl border border-secondary-200 bg-white px-4 py-4">
      <div>
        <p className="text-sm font-medium text-secondary-900">{label}</p>
        <p className="mt-1 text-sm text-secondary-500">{description}</p>
      </div>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
    </label>
  );
}

export function CompanyTraySettingsCard() {
  const { t } = useTranslation('settings');
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);
  const toast = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: traySettingsQueryKey,
    queryFn: async () => {
      if (!window.electron) {
        return defaultTraySettings;
      }

      return window.electron.getTraySettings();
    },
    enabled: isDesktop,
  });
  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: TraySettings) => {
      if (!window.electron) {
        throw new Error('Tray settings are available only in the desktop app.');
      }

      return window.electron.updateTraySettings(settings);
    },
    onSuccess: settings => {
      queryClient.setQueryData(traySettingsQueryKey, settings);
      toast.success({ title: t('company.tray.saved') });
    },
    onError: error => {
      toast.error({
        title: t('company.tray.saveError'),
        description: getErrorMessage(error, t('company.tray.saveError')),
      });
    },
  });

  const settings = settingsQuery.data ?? defaultTraySettings;

  const updateSettings = (patch: Partial<TraySettings>) => {
    const nextSettings = {
      ...settings,
      ...patch,
    };

    if (patch.enabled === false) {
      nextSettings.closeToTray = false;
    }

    void updateSettingsMutation.mutateAsync(nextSettings);
  };

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-100">
          <AppWindow className="h-5 w-5 text-secondary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">{t('company.tray.title')}</h2>
          <p className="text-sm text-secondary-500">
            {t('company.tray.description')}
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          {t('company.tray.desktopOnly')}
        </div>
      )}

      {settingsQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {settingsQuery.error.message}
        </div>
      )}

      <div className="space-y-3">
        <TraySettingToggle
          label={t('company.tray.showIcon')}
          description={t('company.tray.showIconDescription')}
          checked={settings.enabled}
          disabled={!isDesktop || settingsQuery.isLoading || updateSettingsMutation.isPending}
          onChange={checked => updateSettings({ enabled: checked })}
        />

        <TraySettingToggle
          label={t('company.tray.closeToTray')}
          description={t('company.tray.closeToTrayDescription')}
          checked={settings.enabled && settings.closeToTray}
          disabled={
            !isDesktop ||
            !settings.enabled ||
            settingsQuery.isLoading ||
            updateSettingsMutation.isPending
          }
          onChange={checked => updateSettings({ closeToTray: checked })}
        />
      </div>

      {updateSettingsMutation.isPending && (
        <p className="text-sm text-secondary-500">{t('company.tray.saving')}</p>
      )}
    </section>
  );
}
