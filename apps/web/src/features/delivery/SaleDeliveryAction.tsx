/** Entry from an existing sale. The destination repeats site, refund and duplicate eligibility checks. */
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import type { Sale } from '@/types';

/** Read-only sale evidence and the owning dialog's close action. */
interface SaleDeliveryActionProps {
  sale: Sale;
  disabled: boolean;
  onClose: () => void;
}
export function SaleDeliveryAction({ sale, disabled, onClose }: SaleDeliveryActionProps) {
  const { t } = useTranslation('delivery');
  const { user } = useAuth();
  const enabled = useIsModuleActive('delivery');
  if (
    !enabled ||
    !user ||
    !['admin', 'manager'].includes(user.role) ||
    sale.status !== 'completed' ||
    sale.paymentStatus === 'refunded' ||
    sale.paymentStatus === 'partially_refunded' ||
    sale.returns?.length
  )
    return null;
  return (
    <Link
      to={`/delivery?sale=${encodeURIComponent(sale.id)}`}
      aria-disabled={disabled}
      onClick={event => {
        if (disabled) event.preventDefault();
        else onClose();
      }}
      className="inline-flex items-center rounded-lg border border-line px-4 py-2 text-sm font-medium aria-disabled:opacity-50"
    >
      {t('create.fromSale')}
    </Link>
  );
}
