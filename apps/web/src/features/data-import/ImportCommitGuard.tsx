import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { LaunchImportDataMode } from './types';

interface ImportCommitGuardProps {
  completed: boolean;
  confirmed: boolean;
  dataMode: LaunchImportDataMode;
  importing: boolean;
  onConfirm: (confirmed: boolean) => void;
  onImport: () => void;
  ready: number;
}

export function ImportCommitGuard({
  completed,
  confirmed,
  dataMode,
  importing,
  onConfirm,
  onImport,
  ready,
}: ImportCommitGuardProps) {
  const { t } = useTranslation('dataImport');

  if (dataMode === 'demo') {
    return (
      <div
        className="flex max-w-md gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-left text-primary-900"
        data-testid="data-import-demo-preview-only"
        role="status"
      >
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-xs leading-5">{t('safety.demoBoundary.previewOnly')}</span>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-2">
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-left text-xs leading-5 text-warning-950">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-warning-400 text-primary-600 focus:ring-primary-500"
          checked={confirmed}
          disabled={importing || completed || ready === 0}
          onChange={event => onConfirm(event.target.checked)}
        />
        <span>{t('safety.realConfirmation')}</span>
      </label>
      <button
        type="button"
        className="pv-btn primary ml-auto"
        disabled={!confirmed || importing || completed || ready === 0}
        onClick={onImport}
      >
        {importing
          ? t('actions.importing')
          : completed
            ? t('actions.completed')
            : t('actions.importReady', { count: ready })}
      </button>
    </div>
  );
}
