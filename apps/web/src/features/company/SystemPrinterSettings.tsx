import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthOwnerKey } from '@/features/auth/AuthContext';

/** Device-local OS queue selection and explicit synthetic print; neither action records a sale. */
export function SystemPrinterSettings() {
  const owner = useAuthOwnerKey();
  return <SystemPrinterSettingsForOwner key={owner} owner={owner} />;
}

function SystemPrinterSettingsForOwner({ owner }: { owner: string | null }) {
  const { t } = useTranslation('peripherals');
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<{
    success: boolean;
    errorCode?: string;
    error?: string;
  } | null>(null);
  const queryKey = ['desktop', 'system-printers', owner];
  const electron = window.electron;
  const query = useQuery({
    queryKey,
    queryFn: () => electron!.getSystemPrinters!(),
    enabled: Boolean(electron?.getSystemPrinters),
    retry: false,
  });
  const select = useMutation({
    mutationFn: (name: string | null) => electron!.selectSystemPrinter!(name),
    onSuccess: state => {
      queryClient.setQueryData(queryKey, state);
      setTestResult(null);
    },
  });
  const test = useMutation({
    mutationFn: () => electron!.testSystemPrinter!(),
    onSuccess: setTestResult,
  });
  if (!electron?.getSystemPrinters || !electron.selectSystemPrinter || !electron.testSystemPrinter)
    return null;
  const state = query.data;
  const selected = state?.selectedDeviceName ?? '';
  const missing = selected !== '' && !state?.printers.some(printer => printer.name === selected);
  const error = query.error || select.error || test.error;
  return (
    <fieldset className="mt-4 space-y-3 rounded-xl border border-line p-4">
      <legend className="text-sm font-semibold">{t('systemPrinter.title')}</legend>
      <p className="text-sm text-fg3">{t('systemPrinter.localSelection')}</p>
      <label htmlFor="system-printer-name" className="label">
        {t('systemPrinter.title')}
      </label>
      <select
        id="system-printer-name"
        className="input"
        value={selected}
        disabled={!state || select.isPending || test.isPending || query.isFetching}
        onChange={event => select.mutate(event.target.value || null)}
      >
        <option value="">{t('systemPrinter.askEachTime')}</option>
        {missing && (
          <option value={selected}>
            {selected} — {t('systemPrinter.unavailable')}
          </option>
        )}
        {state?.printers.map(printer => (
          <option key={printer.name} value={printer.name}>
            {printer.displayName || printer.name}
          </option>
        ))}
      </select>
      {state?.printers.length === 0 && (
        <p role="status" className="text-sm text-warning-700">
          {t('systemPrinter.noQueues')}
        </p>
      )}
      {missing && (
        <p role="alert" className="text-sm text-danger-700">
          {t('systemPrinter.missingQueue')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-outline"
          disabled={query.isFetching || select.isPending || test.isPending}
          onClick={() => {
            void query.refetch();
          }}
        >
          {t('systemPrinter.refreshPrinters')}
        </button>
        <button
          type="button"
          className="btn-outline"
          disabled={
            !state?.printers.length ||
            missing ||
            select.isPending ||
            test.isPending ||
            query.isFetching
          }
          onClick={() => {
            setTestResult(null);
            test.mutate();
          }}
        >
          {t('systemPrinter.printTest')}
        </button>
      </div>
      <p className="text-xs text-fg3">{t('systemPrinter.testHelp')}</p>
      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {t('systemPrinter.printerError')} {error instanceof Error ? error.message : ''}
        </p>
      )}
      {testResult && (
        <p role="status" className="text-sm">
          {testResult.success
            ? t('systemPrinter.testSubmitted')
            : testResult.errorCode === 'PRINT_CANCELLED'
              ? t('systemPrinter.testCancelled')
              : testResult.error || t('systemPrinter.printerError')}
        </p>
      )}
    </fieldset>
  );
}
