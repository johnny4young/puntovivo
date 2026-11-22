import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { trpc } from '@/lib/trpc';

export interface CustomerAccount {
  balance: number;
  creditLimit: number;
}

/**
 * Debt and cupo of the ticket's customer while the register sells on credit.
 * `account` stays null until the read lands, so nothing shows a made-up zero.
 */
export function useCustomerAccount(customerId: string | null) {
  const sellsOnCredit = useRegisterZone('credit');
  const enabled = sellsOnCredit && !!customerId;
  const query = trpc.customerLedger.getBalance.useQuery(
    { customerId: customerId ?? '' },
    { enabled, staleTime: 30_000 }
  );
  const account: CustomerAccount | null = enabled && query.data ? query.data : null;
  return { sellsOnCredit, account };
}

/** A customer with a cupo or any balance has an account worth showing. */
export function hasAccount(account: CustomerAccount | null): account is CustomerAccount {
  return !!account && (account.creditLimit > 0 || account.balance !== 0);
}
