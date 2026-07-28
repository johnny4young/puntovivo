import { type ComponentProps } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import { trpc } from '@/lib/trpc';
import type { Sale } from '@/types';

type SalesHistoryTableProps = ComponentProps<typeof SalesHistoryTable>;

export type SalesHistoryDrawerContentProps = Omit<
  SalesHistoryTableProps,
  'sales' | 'isLoading' | 'error' | 'onRetry'
>;

/**
 * Keeps the history query observer behind the drawer's conditional mount so
 * the POS first paint does not construct secondary React Query work.
 */
export function SalesHistoryDrawerContent(props: SalesHistoryDrawerContentProps) {
  const salesQuery = trpc.sales.list.useQuery(
    { page: 1, perPage: 50 },
    { placeholderData: keepPreviousData }
  );

  return (
    <SalesHistoryTable
      {...props}
      sales={(salesQuery.data?.items ?? []) as Sale[]}
      isLoading={salesQuery.isLoading}
      error={salesQuery.error?.message ?? null}
      onRetry={() => {
        void salesQuery.refetch();
      }}
    />
  );
}
