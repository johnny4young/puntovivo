import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

interface ReceiptPrintSettings {
  silent: boolean;
  printBackground: boolean;
}

const defaultPrintSettings: ReceiptPrintSettings = {
  silent: false,
  printBackground: true,
};

const receiptPrintSettingsQueryKey = ['desktop', 'receipt-print-settings'] as const;

interface PrintSettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

function PrintSettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: PrintSettingToggleProps) {
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

export function CompanyPrintSettingsCard() {
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: receiptPrintSettingsQueryKey,
    queryFn: async () => {
      if (!window.electron) {
        return defaultPrintSettings;
      }

      return window.electron.getReceiptPrintSettings();
    },
    enabled: isDesktop,
  });
  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: ReceiptPrintSettings) => {
      if (!window.electron) {
        throw new Error('Receipt print settings are available only in the desktop app.');
      }

      return window.electron.updateReceiptPrintSettings(settings);
    },
    onSuccess: settings => {
      queryClient.setQueryData(receiptPrintSettingsQueryKey, settings);
    },
  });

  const settings = settingsQuery.data ?? defaultPrintSettings;

  const updateSetting = (patch: Partial<ReceiptPrintSettings>) => {
    const nextSettings = {
      ...settings,
      ...patch,
    };

    void updateSettingsMutation.mutateAsync(nextSettings);
  };

  return (
    <section className="card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Printer className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">Receipt Print Settings</h2>
          <p className="text-sm text-secondary-500">
            Configure how desktop receipt printing behaves for this workstation.
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          Receipt print settings are available in the Electron desktop app.
        </div>
      )}

      {settingsQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {settingsQuery.error.message}
        </div>
      )}

      <div className="space-y-3">
        <PrintSettingToggle
          label="Silent Printing"
          description="Print receipts without showing the operating system print dialog."
          checked={settings.silent}
          disabled={!isDesktop || settingsQuery.isLoading || updateSettingsMutation.isPending}
          onChange={checked => updateSetting({ silent: checked })}
        />

        <PrintSettingToggle
          label="Print Background Graphics"
          description="Include receipt background styles and shading in the printed output."
          checked={settings.printBackground}
          disabled={!isDesktop || settingsQuery.isLoading || updateSettingsMutation.isPending}
          onChange={checked => updateSetting({ printBackground: checked })}
        />
      </div>

      {updateSettingsMutation.isPending && (
        <p className="text-sm text-secondary-500">Saving print settings...</p>
      )}
    </section>
  );
}
