import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { DesktopOnlyChip, DisabledControl } from '@/components/feedback/DesktopOnlyChip';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';

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
    <label className="pv-check-row cursor-pointer">
      <input
        type="checkbox"
        className="pv-box mt-0.5 h-5 w-5 appearance-none accent-primary-600 checked:border-primary-600 checked:bg-primary-600 disabled:cursor-not-allowed focus-visible:shadow-[var(--focus-ring)]"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
      <span className="grow">
        <span className="block text-sm font-semibold text-fg1">{label}</span>
        <span className="mt-0.5 block text-xs text-fg3">{description}</span>
      </span>
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
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.tray.saveError' }),
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

  const toggles = (
    <div>
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
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-ink flex h-10 w-10 flex-shrink-0 items-center justify-center">
            <AppWindow className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="pv-title text-lg">{t('company.tray.title')}</h2>
            <p className="mt-1 text-sm text-fg3">{t('company.tray.description')}</p>
          </div>
        </div>
        {!isDesktop && <DesktopOnlyChip />}
      </div>

      {!isDesktop && <p className="mt-3 text-xs text-fg3">{t('company.tray.desktopOnly')}</p>}

      {settingsQuery.error && (
        <div className="mt-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(settingsQuery.error, t, t('errors:server.unknown'))}
        </div>
      )}

      <div className="mt-4">{isDesktop ? toggles : <DisabledControl>{toggles}</DisabledControl>}</div>

      {updateSettingsMutation.isPending && (
        <p className="mt-3 text-xs text-fg3">{t('company.tray.saving')}</p>
      )}
    </section>
  );
}
