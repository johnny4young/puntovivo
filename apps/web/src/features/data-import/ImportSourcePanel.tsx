import { LoaderCircle, RotateCcw, Upload } from 'lucide-react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParsedImportFile } from './fileParser';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/utils';
interface ImportSourcePanelProps {
  file: ParsedImportFile | null;
  fileError: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  isBusy: boolean;
  isParsing: boolean;
  onFile: (file: File) => void;
  onReset: () => void;
}
export function ImportSourcePanel({
  file,
  fileError,
  inputRef,
  isBusy,
  isParsing,
  onFile,
  onReset,
}: ImportSourcePanelProps) {
  const { t } = useTranslation('dataImport');
  return (
    <section className="card space-y-5 p-6" aria-labelledby="data-import-upload-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">
          {t('steps.upload.kicker')}
        </p>
        <h2 id="data-import-upload-title" className="mt-1 text-lg font-semibold text-secondary-900">
          {t('steps.upload.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('steps.upload.description')}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label
          className={cn(
            buttonVariants({ variant: 'primary' }),
            'w-fit',
            isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          )}
          htmlFor="data-import-file"
          aria-disabled={isBusy}
        >
          {isParsing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="h-4 w-4" aria-hidden="true" />
          )}
          {t('actions.chooseFile')}
        </label>
        <input
          ref={inputRef}
          id="data-import-file"
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={isBusy}
          onChange={event => {
            const selected = event.target.files?.[0];
            if (selected) onFile(selected);
          }}
        />
        {file ? (
          <div className="min-w-0 text-sm text-secondary-700" aria-live="polite">
            <p className="truncate font-semibold">{file.sourceName}</p>
            <p className="text-xs text-secondary-500">
              {t('fileSummary', {
                rows: file.rows.length,
                columns: file.headers.length,
              })}
            </p>
          </div>
        ) : null}
        {file ? (
          <Button
            type="button"
            className="sm:ml-auto"
            disabled={isBusy}
            onClick={onReset}
            variant="ghost"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('actions.reset')}
          </Button>
        ) : null}
      </div>
      {fileError ? (
        <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {fileError}
        </p>
      ) : null}
    </section>
  );
}
