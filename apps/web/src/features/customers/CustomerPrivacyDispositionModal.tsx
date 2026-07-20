/** previewed, explicit customer personal-data disposition. */
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

export type CustomerPrivacyDispositionPreview =
  inferRouterOutputs<AppRouter>['customers']['previewPersonalDataDisposition'];

const LINKED_RECORD_SECTIONS = [
  'sales',
  'quotations',
  'ledgerEntries',
  'deliveryOrders',
  'fiscalDocuments',
] as const;

export interface CustomerPrivacyDispositionModalProps {
  isOpen: boolean;
  customerName: string;
  preview?: CustomerPrivacyDispositionPreview | undefined;
  isLoading: boolean;
  error?: string | null | undefined;
  confirmation: string;
  isSubmitting: boolean;
  onConfirmationChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function CustomerPrivacyDispositionModal({
  isOpen,
  customerName,
  preview,
  isLoading,
  error,
  confirmation,
  isSubmitting,
  onConfirmationChange,
  onClose,
  onConfirm,
}: CustomerPrivacyDispositionModalProps) {
  const { t } = useTranslation('customers');
  const canConfirm =
    !!preview && confirmation === preview.customer.name && !isLoading && !isSubmitting;
  const isAnonymizing = preview?.disposition === 'anonymize';
  const confirmationName = preview?.customer.name ?? customerName;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('privacy.disposition.title')}
      size="md"
      closeOnBackdrop={!isSubmitting}
      closeOnEsc={!isSubmitting}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSubmitting}>
            {t('privacy.disposition.cancel')}
          </ModalButton>
          <ModalButton variant="danger" onClick={onConfirm} disabled={!canConfirm}>
            {isSubmitting
              ? t('privacy.disposition.submitting')
              : t(
                  isAnonymizing
                    ? 'privacy.disposition.confirmAnonymize'
                    : 'privacy.disposition.confirmDelete'
                )}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-5" data-testid="customer-privacy-disposition-modal">
        {isLoading && (
          <div className="flex items-center gap-3 text-sm text-secondary-600" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            {t('privacy.disposition.loading')}
          </div>
        )}

        {error && (
          <div
            className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800"
            role="alert"
          >
            {t('privacy.disposition.previewError')}
          </div>
        )}

        {preview && (
          <>
            <div
              className={`rounded-2xl border p-4 ${
                isAnonymizing
                  ? 'border-warning-200 bg-warning-50'
                  : 'border-success-200 bg-success-50'
              }`}
            >
              <div className="flex items-start gap-3">
                {isAnonymizing ? (
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-warning-700"
                    aria-hidden="true"
                  />
                ) : (
                  <ShieldCheck
                    className="mt-0.5 h-5 w-5 shrink-0 text-success-700"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <h3 className="font-semibold text-secondary-950">
                    {t(
                      isAnonymizing
                        ? 'privacy.disposition.anonymizeHeading'
                        : 'privacy.disposition.deleteHeading'
                    )}
                  </h3>
                  <p className="mt-1 text-sm text-secondary-700">
                    {t(
                      isAnonymizing
                        ? 'privacy.disposition.anonymizeDescription'
                        : 'privacy.disposition.deleteDescription'
                    )}
                  </p>
                </div>
              </div>
            </div>

            {isAnonymizing && (
              <div>
                <p className="text-sm font-semibold text-secondary-900">
                  {t('privacy.disposition.linkedRecords', {
                    count: preview.totalLinkedRecords,
                  })}
                </p>
                <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {LINKED_RECORD_SECTIONS.map(section => (
                    <div
                      key={section}
                      className="flex items-center justify-between rounded-lg bg-secondary-50 px-3 py-2 text-sm"
                    >
                      <dt className="text-secondary-600">
                        {t(`privacy.disposition.records.${section}`)}
                      </dt>
                      <dd className="font-semibold tabular-nums text-secondary-950">
                        {preview.linkedRecordCounts[section]}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-secondary-600">
                  {t('privacy.disposition.retentionNote')}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="customer-privacy-confirmation" className="label">
                {t('privacy.disposition.confirmationLabel')}
              </label>
              <p className="mb-2 text-sm text-secondary-600">
                {t('privacy.disposition.confirmationInstruction')}{' '}
                <strong className="font-semibold text-secondary-950">{confirmationName}</strong>
              </p>
              <input
                id="customer-privacy-confirmation"
                className="input w-full"
                value={confirmation}
                onChange={event => onConfirmationChange(event.target.value)}
                autoComplete="off"
                disabled={isSubmitting}
                aria-describedby="customer-privacy-confirmation-help"
              />
              <p
                id="customer-privacy-confirmation-help"
                className="mt-2 text-xs text-secondary-500"
              >
                {t('privacy.disposition.irreversible')}
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
