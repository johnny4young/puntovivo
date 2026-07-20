import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Download, FileSignature, FileText, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { formatDateTime } from '@/lib/utils';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DayCloseReport = RouterOutputs['reports']['dayClose']['preview'];
type DayCloseSignoff = NonNullable<RouterOutputs['reports']['dayClose']['signoff']>;

interface DayCloseSignoffCardProps {
  date: string;
  report: DayCloseReport;
  signoff: DayCloseSignoff | null;
  isSigning: boolean;
  isDownloadingPdf: boolean;
  onSign: () => void;
  onDownloadPdf: () => void;
}

/** explicit irreversible attestation + immutable evidence state. */
export function DayCloseSignoffCard({
  date,
  report,
  signoff,
  isSigning,
  isDownloadingPdf,
  onSign,
  onDownloadPdf,
}: DayCloseSignoffCardProps) {
  const { t, i18n } = useTranslation('reports');
  const [accepted, setAccepted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (signoff) {
    return (
      <section
        className="rounded-2xl border border-success-300 bg-success-50 p-5 sm:p-6"
        data-testid="day-close-signed-evidence"
        aria-labelledby="day-close-signed-title"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-success-100 p-2 text-success-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="day-close-signed-title" className="font-semibold text-success-950">
              {t('dayClose.signoff.signedTitle')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-success-900/80">
              {t('dayClose.signoff.signedDescription')}
            </p>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-success-800/70">
                  {t('dayClose.signoff.signedByLabel')}
                </dt>
                <dd className="mt-1 text-success-950">
                  {t('dayClose.signoff.signedBy', {
                    name: signoff.signedBy.name,
                    date: formatDateTime(signoff.signedAt),
                  })}
                </dd>
              </div>
              <div>
                <dt className="font-semibold uppercase tracking-[0.12em] text-success-800/70">
                  {t('dayClose.signoff.hashLabel')}
                </dt>
                <dd
                  className="mt-1 break-all font-mono text-[11px] text-success-950"
                  data-testid="day-close-signoff-hash"
                >
                  {signoff.reportHash}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-success-200 bg-white/55 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-success-950">
                    {t('dayClose.signoff.pdfTitle')}
                  </p>
                  <p className="mt-0.5 break-words text-xs leading-5 text-success-900/75">
                    {signoff.pdf
                      ? t('dayClose.signoff.pdfDescription', {
                          filename: signoff.pdf.filename,
                          size: new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
                            maximumFractionDigits: 1,
                          }).format(signoff.pdf.byteSize / 1024),
                        })
                      : t('dayClose.signoff.pdfUnavailable')}
                  </p>
                </div>
              </div>
              {signoff.pdf && (
                <button
                  type="button"
                  className="pv-btn outline shrink-0 justify-center"
                  disabled={isDownloadingPdf}
                  onClick={onDownloadPdf}
                  data-testid="day-close-pdf-download"
                >
                  <Download
                    className={isDownloadingPdf ? 'animate-pulse' : ''}
                    aria-hidden="true"
                  />
                  {t(
                    isDownloadingPdf
                      ? 'dayClose.signoff.pdfDownloading'
                      : 'dayClose.signoff.pdfDownload'
                  )}
                </button>
              )}
            </div>
          </div>
          <LockKeyhole
            className="hidden h-5 w-5 shrink-0 text-success-700 sm:block"
            aria-hidden="true"
          />
        </div>
      </section>
    );
  }

  const blocked = !report.readiness.readyToSign;
  const canOpenConfirmation = accepted && !blocked && !isSigning;

  return (
    <>
      <section
        className="card border-primary-200 p-5 sm:p-6"
        data-testid="day-close-signoff-card"
        aria-labelledby="day-close-signoff-title"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary-50 p-2 text-primary-700">
              <FileSignature className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="day-close-signoff-title" className="font-semibold text-secondary-950">
                {t('dayClose.signoff.title')}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary-500">
                {t(blocked ? 'dayClose.signoff.blocked' : 'dayClose.signoff.description')}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 lg:max-w-md">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-secondary-200 bg-secondary-50/70 p-3 text-sm text-secondary-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                checked={accepted}
                disabled={blocked || isSigning}
                onChange={event => setAccepted(event.target.checked)}
              />
              <span>{t('dayClose.signoff.attestation')}</span>
            </label>
            <button
              type="button"
              className="pv-btn primary justify-center"
              disabled={!canOpenConfirmation}
              onClick={() => setConfirmOpen(true)}
            >
              <FileSignature className="h-4 w-4" aria-hidden="true" />
              {t('dayClose.signoff.action')}
            </button>
          </div>
        </div>
      </section>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onSign}
        title={t('dayClose.signoff.confirmTitle')}
        message={t('dayClose.signoff.confirmMessage', {
          date,
          generatedAt: formatDateTime(report.generatedAt),
        })}
        confirmText={t('dayClose.signoff.confirmAction')}
        variant="primary"
        loading={isSigning}
      />
    </>
  );
}
