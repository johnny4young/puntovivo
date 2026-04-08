import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow } from 'lucide-react';
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
      toast.success({ title: 'Tray settings saved' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to save tray settings',
        description: getErrorMessage(error, 'Unable to save tray settings'),
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
          <h2 className="text-lg font-semibold text-secondary-900">System Tray</h2>
          <p className="text-sm text-secondary-500">
            Control whether this workstation stays available from the desktop tray.
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          Tray settings are available in the Electron desktop app.
        </div>
      )}

      {settingsQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {settingsQuery.error.message}
        </div>
      )}

      <div className="space-y-3">
        <TraySettingToggle
          label="Show Tray Icon"
          description="Keep a system tray icon available so the workstation can be reopened quickly."
          checked={settings.enabled}
          disabled={!isDesktop || settingsQuery.isLoading || updateSettingsMutation.isPending}
          onChange={checked => updateSettings({ enabled: checked })}
        />

        <TraySettingToggle
          label="Close Window To Tray"
          description="Hide the main window instead of quitting the app when the close button is used."
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
        <p className="text-sm text-secondary-500">Saving tray settings...</p>
      )}
    </section>
  );
}
