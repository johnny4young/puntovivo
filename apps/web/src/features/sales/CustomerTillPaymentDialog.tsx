import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import {
  CustomerLedgerAbonoModal,
  type CustomerLedgerAbonoValues,
} from '@/features/customers/CustomerLedgerAbonoModal';
import { onErrorToast } from '@/lib/mutationHelpers';
import { invalidateCommittedGroups } from '@/lib/invalidateGroups';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

interface CustomerTillPaymentDialogProps {
  customerId: string;
  customerName: string;
  balance: number;
  onClose: () => void;
}

/** Abono taken at the register: pays the account down and enters the open drawer. */
export default function CustomerTillPaymentDialog({
  customerId,
  customerName,
  balance,
  onClose,
}: CustomerTillPaymentDialogProps) {
  const { t } = useTranslation(['customers', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const addTillPayment = useCriticalMutation('customerLedger.addTillPayment', {
    onSuccess: async () => {
      // The payment is committed: a failed refresh must not read as a failed payment.
      await Promise.allSettled([
        utils.customerLedger.getBalance.invalidate({ customerId }),
        utils.customerLedger.list.invalidate({ customerId }),
        invalidateCommittedGroups(utils, [
          u => u.cashSessions.getActive,
          u => u.cashSessions.movements,
          u => u.cashSessions.report,
          u => u.cashSessions.myShiftSummary,
        ]),
      ]);
      toast.success({ title: t('ledger.tillModal.success') });
      onClose();
    },
    onError: onErrorToast(toast, t, { titleKey: 'ledger.tillModal.error' }),
  });

  const handleSubmit = async (values: CustomerLedgerAbonoValues) => {
    try {
      await addTillPayment.mutateAsync({
        customerId,
        amount: values.amount,
        note: values.note || undefined,
      });
    } catch {
      // The toast and the inline error already report it.
    }
  };

  return (
    <CustomerLedgerAbonoModal
      mode="till"
      isOpen
      isSaving={addTillPayment.isPending}
      error={
        addTillPayment.error
          ? translateServerError(addTillPayment.error, t, t('errors:server.unknown'))
          : null
      }
      onClose={onClose}
      onSubmit={handleSubmit}
      balance={balance}
      customerName={customerName}
    />
  );
}
