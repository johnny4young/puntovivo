import { useTranslation } from 'react-i18next';
import { BadgeDollarSign, Sparkles } from 'lucide-react';
import { trpc } from '@/lib/trpc';

/**
 * () — the customer's point balance, right where the cashier
 * picks them at checkout. Self-contained: renders nothing without a
 * customer (walk-in), while the read is in flight, or when the customer has
 * no points — the chip only appears when it has something to say, so the
 * payment surface stays quiet for the tenants that never enabled loyalty.
 */
import { Badge } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
export function CustomerLoyaltyChip({ customerId }: { customerId: string | null }) {
  const { t } = useTranslation('sales');
  const loyaltyQuery = trpc.loyalty.forCustomer.useQuery(
    {
      customerId: customerId ?? '',
      limit: 1,
    },
    {
      enabled: !!customerId,
      staleTime: 30_000,
    }
  );

  // Cache-leak guard ( lesson): `enabled: false` still serves cached
  // data from a previous customer, so gate the read on the flag too.
  const points = customerId ? (loyaltyQuery.data?.points ?? 0) : 0;
  const storeCredit = customerId ? (loyaltyQuery.data?.storeCredit?.balance ?? 0) : 0;
  if (!customerId || (points <= 0 && storeCredit <= 0)) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="customer-value-chips">
      {points > 0 && (
        <Badge
          className="inline-flex items-center gap-1"
          data-testid="customer-loyalty-chip"
          variant="primary"
        >
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {t('loyalty.pointsBalance', { count: points })}
        </Badge>
      )}
      {storeCredit > 0 && (
        <Badge
          className="inline-flex items-center gap-1"
          data-testid="customer-store-credit-chip"
          variant="success"
        >
          <BadgeDollarSign className="h-3 w-3" aria-hidden="true" />
          {t('loyalty.storeCreditBalance', { amount: formatCurrency(storeCredit) })}
        </Badge>
      )}
    </div>
  );
}
