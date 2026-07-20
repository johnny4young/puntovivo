/** copy/download controls for the allowlist-only support snapshot. */

import { Copy, Download, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { downloadFile } from '@/services/export/exportService';
import {
  createSupportSnapshot,
  serializeSupportSnapshot,
  supportSnapshotFilename,
  type SupportSnapshotSource,
} from './supportSnapshot';

interface SupportSnapshotPanelProps {
  source: SupportSnapshotSource;
  disabled: boolean;
}

export function SupportSnapshotPanel({ source, disabled }: SupportSnapshotPanelProps) {
  const { t } = useTranslation('operations');
  const toast = useToast();

  async function copySnapshot(): Promise<void> {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      const snapshot = createSupportSnapshot(source);
      await navigator.clipboard.writeText(serializeSupportSnapshot(snapshot));
      toast.success({ title: t('support.snapshot.toast.copied') });
    } catch {
      toast.error({ title: t('support.snapshot.toast.copyError') });
    }
  }

  function downloadSnapshot(): void {
    try {
      const snapshot = createSupportSnapshot(source);
      const content = serializeSupportSnapshot(snapshot);
      downloadFile(
        new Blob([content], { type: 'application/json;charset=utf-8' }),
        supportSnapshotFilename(snapshot.generatedAt)
      );
      toast.success({ title: t('support.snapshot.toast.downloaded') });
    } catch {
      toast.error({ title: t('support.snapshot.toast.downloadError') });
    }
  }

  return (
    <section className="card overflow-hidden" data-testid="support-snapshot-panel">
      <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="pv-gt pv-gt-success h-11 w-11 shrink-0 rounded-xl">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="pv-kicker">{t('support.snapshot.kicker')}</p>
            <h2 className="pv-title text-xl">{t('support.snapshot.title')}</h2>
            <p className="mt-1 max-w-3xl text-sm text-fg3">{t('support.snapshot.description')}</p>
            <p className="mt-2 text-xs font-medium text-success-700">
              {t('support.snapshot.privacyBoundary')}
            </p>
            {disabled && (
              <p className="mt-2 text-xs font-medium text-warning-700" role="status">
                {t('support.snapshot.unavailable')}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-nowrap">
          <button
            type="button"
            className="pv-btn outline"
            onClick={() => void copySnapshot()}
            disabled={disabled}
            data-testid="support-snapshot-copy"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            {t('support.snapshot.actions.copy')}
          </button>
          <button
            type="button"
            className="pv-btn primary"
            onClick={downloadSnapshot}
            disabled={disabled}
            data-testid="support-snapshot-download"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('support.snapshot.actions.download')}
          </button>
        </div>
      </div>
    </section>
  );
}
