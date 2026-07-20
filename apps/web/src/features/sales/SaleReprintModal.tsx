import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

export type ReprintReason = 'paper_out' | 'customer_request' | 'prior_print_error' | 'other';

const REPRINT_REASONS: ReprintReason[] = [
  'paper_out',
  'customer_request',
  'prior_print_error',
  'other',
];

interface SaleReprintModalProps {
  isOpen: boolean;
  isPending: boolean;
  isPrinting: boolean;
  reason: ReprintReason | '';
  reasonDetail: string;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onReasonChange: (reason: ReprintReason | '') => void;
  onReasonDetailChange: (detail: string) => void;
}

// keep the reprint form presentational; SaleDetailsModal owns
// mutation state, printing, query invalidation, and the close lifecycle.
export function SaleReprintModal({
  isOpen,
  isPending,
  isPrinting,
  reason,
  reasonDetail,
  error,
  onClose,
  onConfirm,
  onReasonChange,
  onReasonDetailChange,
}: SaleReprintModalProps) {
  const { t } = useTranslation('sales');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('reprint.title')}
      size="sm"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isPending}>
            {t('reprint.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={onConfirm} disabled={isPending}>
            {isPending || isPrinting ? t('reprint.printing') : t('reprint.confirm')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-secondary-600">{t('reprint.description')}</p>
        <label className="block text-sm">
          <span className="font-medium text-secondary-800">{t('reprint.reasonLabel')}</span>
          <select
            className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-1 text-sm"
            value={reason}
            onChange={event => {
              const next = event.target.value as ReprintReason | '';
              onReasonChange(next);
              if (next !== 'other') {
                onReasonDetailChange('');
              }
            }}
            disabled={isPending}
          >
            <option value="">—</option>
            {REPRINT_REASONS.map(option => (
              <option key={option} value={option}>
                {t(`reprint.reasonOptions.${option}`)}
              </option>
            ))}
          </select>
        </label>
        {reason === 'other' && (
          <label className="block text-sm">
            <span className="font-medium text-secondary-800">{t('reprint.reasonDetailLabel')}</span>
            <textarea
              className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-1 text-sm"
              rows={2}
              maxLength={240}
              value={reasonDetail}
              onChange={event => onReasonDetailChange(event.target.value)}
              placeholder={t('reprint.reasonDetailPlaceholder')}
              disabled={isPending}
            />
          </label>
        )}
        {error && (
          <p className="text-sm text-danger-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
