import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { CheckoutApprovalPanel } from './CheckoutApprovalPanel';
import type { ApprovalRequestView } from './useCheckoutApprovals';

export interface CashDrawerApprovalModalProps {
  isOpen: boolean;
  isLoading: boolean;
  isRequesting: boolean;
  isDispatching: boolean;
  hasError: boolean;
  allApproved: boolean;
  views: ApprovalRequestView<'cash_drawer_open'>[];
  onRequest: (action: 'cash_drawer_open', reason: string) => void;
  onRefresh: () => void;
  onClose: () => void;
  onConfirm: () => void;
}

/** ENG-106c3 — cashier escalation without replacing the active session. */
export function CashDrawerApprovalModal({
  isOpen,
  isLoading,
  isRequesting,
  isDispatching,
  hasError,
  allApproved,
  views,
  onRequest,
  onRefresh,
  onClose,
  onConfirm,
}: CashDrawerApprovalModalProps) {
  const { t } = useTranslation(['cashDrawer', 'common']);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('cashDrawer:approval.title')}
      size="sm"
      closeOnBackdrop={!isDispatching}
      closeOnEsc={!isDispatching}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isDispatching}>
            {t('common:actions.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={onConfirm}
            disabled={isDispatching || !allApproved}
          >
            {isDispatching ? t('cashDrawer:approval.opening') : t('cashDrawer:approval.confirm')}
          </ModalButton>
        </>
      }
    >
      <div>
        <CheckoutApprovalPanel
          views={views}
          isLoading={isLoading}
          isHashing={false}
          isRequesting={isRequesting}
          hasError={hasError}
          onRequest={onRequest}
          onRefresh={onRefresh}
        />
      </div>
    </Modal>
  );
}
