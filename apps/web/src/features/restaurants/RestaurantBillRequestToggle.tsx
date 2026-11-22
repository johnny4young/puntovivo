import { ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { cn } from '@/lib/utils';

interface RestaurantBillRequestToggleProps {
  tableId: string;
  requested: boolean;
  disabled?: boolean;
}

/** Staff mark that the table asked for the bill; the floor map shows it. */
export function RestaurantBillRequestToggle({
  tableId,
  requested,
  disabled = false,
}: RestaurantBillRequestToggleProps) {
  const { t } = useTranslation(['restaurants', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const mutation = trpc.restaurantServices.setBillRequested.useMutation({
    onSettled: async () => {
      await Promise.all([
        utils.restaurantServices.getTableState.invalidate({ tableId }),
        utils.restaurantTables.listSummary.invalidate(),
      ]);
    },
    onError: onErrorToast(toast, t, { titleKey: 'restaurants:billRequest.error' }),
  });
  return (
    <button
      type="button"
      aria-pressed={requested}
      disabled={disabled || mutation.isPending}
      onClick={() => mutation.mutate({ tableId, requested: !requested })}
      className={cn(
        'btn-outline min-h-11 w-fit',
        requested &&
          'border-warning-500 bg-warning-500 text-rail hover:border-warning-500 hover:bg-warning-500 hover:text-rail'
      )}
      data-testid="restaurant-bill-request-toggle"
    >
      <ReceiptText className="h-4 w-4" aria-hidden="true" />
      {t('restaurants:billRequest.label')}
    </button>
  );
}
