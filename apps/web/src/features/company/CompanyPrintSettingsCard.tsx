import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { DesktopOnlyChip, DisabledControl } from '@/components/feedback/DesktopOnlyChip';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';

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

export function CompanyPrintSettingsCard() {
  const { t } = useTranslation('settings');
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const isDesktop = Boolean(electron);
  const toast = useToast();
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
      toast.success({ title: t('company.print.saved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'settings:company.print.saveError' }),
  });

  const settings = settingsQuery.data ?? defaultPrintSettings;

  const updateSetting = (patch: Partial<ReceiptPrintSettings>) => {
    const nextSettings = {
      ...settings,
      ...patch,
    };

    void updateSettingsMutation.mutateAsync(nextSettings);
  };

  const toggles = (
    <div>
      <PrintSettingToggle
        label={t('company.print.silentPrinting')}
        description={t('company.print.silentPrintingDescription')}
        checked={settings.silent}
        disabled={!isDesktop || settingsQuery.isLoading || updateSettingsMutation.isPending}
        onChange={checked => updateSetting({ silent: checked })}
      />

      <PrintSettingToggle
        label={t('company.print.printBackground')}
        description={t('company.print.printBackgroundDescription')}
        checked={settings.printBackground}
        disabled={!isDesktop || settingsQuery.isLoading || updateSettingsMutation.isPending}
        onChange={checked => updateSetting({ printBackground: checked })}
      />
    </div>
  );

  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-primary flex h-10 w-10 flex-shrink-0 items-center justify-center">
            <Printer className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="pv-title text-lg">{t('company.print.title')}</h2>
            <p className="mt-1 text-sm text-fg3">{t('company.print.description')}</p>
          </div>
        </div>
        {!isDesktop && <DesktopOnlyChip />}
      </div>

      {!isDesktop && <p className="mt-3 text-xs text-fg3">{t('company.print.desktopOnly')}</p>}

      {settingsQuery.error && (
        <div className="mt-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(settingsQuery.error, t, t('errors:server.unknown'))}
        </div>
      )}

      <div className="mt-4">{isDesktop ? toggles : <DisabledControl>{toggles}</DisabledControl>}</div>

      {updateSettingsMutation.isPending && (
        <p className="mt-3 text-xs text-fg3">{t('company.print.saving')}</p>
      )}
    </section>
  );
}
