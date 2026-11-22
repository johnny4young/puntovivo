/**
 * Two or more accounts of one table side by side. Each arrow, «Por comensal»
 * and the first plate sent to «Otra cuenta» apply at once on the server, so
 * the columns always show the checks the register will charge.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Plus, Users } from 'lucide-react';

import { RESTAURANT_REGROUP_MAX_ACCOUNTS } from '@puntovivo/shared/restaurant-split';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateCommittedGroups, RESTAURANT_TABLE_INVALIDATIONS } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCurrency } from '@/lib/utils';
import type { ResumeDraftSelection } from '@/features/sales/useSalesFlows';
import {
  canSplitByDiner,
  checksSeen,
  moveTargets,
  planForMove,
  splitAccountsFromTableState,
  type SplitAccount,
} from './splitAccounts';

interface RestaurantSplitSheetProps {
  tableId: string | null;
  tableName: string;
  onClose: () => void;
  /** Hands one account to the register; omitted where no register is available. */
  onCharge?: ((account: ResumeDraftSelection) => void) | undefined;
}

export function RestaurantSplitSheet({
  tableId,
  tableName,
  onClose,
  onCharge,
}: RestaurantSplitSheetProps) {
  const { t, i18n } = useTranslation(['restaurants', 'errors', 'common', 'fulfillmentErrors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [emptyAccounts, setEmptyAccounts] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const showError = onErrorToast(toast, t, { titleKey: 'restaurants:splitSheet.errorTitle' });
  const stateQuery = trpc.restaurantServices.getTableState.useQuery(
    tableId ? { tableId } : (undefined as never),
    { enabled: tableId !== null }
  );
  const regroup = useCriticalMutation('restaurantServices.regroupChecks', {
    onSuccess: async (_data, variables) => {
      if (variables.plan.kind === 'byDiner') {
        // After «Por comensal» the columns read by diner again.
        setOrder([]);
        setEmptyAccounts(0);
      } else {
        const opened = variables.plan.accounts.filter(account => account.checkId === null).length;
        setEmptyAccounts(current => Math.max(0, current - opened));
      }
      await invalidateCommittedGroups(utils, [
        u => u.sales.listDrafts,
        ...RESTAURANT_TABLE_INVALIDATIONS,
      ]);
    },
    onError: error => {
      showError(error);
      // A stale view is the usual cause; show the table as it is now.
      if (tableId) void utils.restaurantServices.getTableState.invalidate({ tableId });
    },
  });

  const accounts = useMemo(
    () => splitAccountsFromTableState(stateQuery.data, emptyAccounts, order),
    [stateQuery.data, emptyAccounts, order]
  );
  // The server refuses any regroup while a register holds one of the checks.
  const inUse = accounts.some(account => account.checkId !== null && account.suspendedAt === null);
  const busy = regroup.isPending;
  const locked = busy || inUse;
  const list = useMemo(
    () => new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }),
    [i18n.language]
  );
  const seatName = (seat: number | null) =>
    seat === null
      ? t('restaurants:rail.sharedTag')
      : t('restaurants:rail.dinerTag', { count: seat });
  const accountName = (account: SplitAccount, index: number) =>
    account.seats.length === 0
      ? t('restaurants:splitSheet.account', { count: index + 1 })
      : t('restaurants:splitSheet.accountWithDiners', {
          count: index + 1,
          diners: list.format(account.seats.map(seatName)),
        });

  const moveLine = (saleItemId: string, targetIndex: number) => {
    if (!tableId || locked) return;
    if (order.length === 0) {
      setOrder(accounts.flatMap(account => (account.checkId ? [account.checkId] : [])));
    }
    regroup.mutate({
      tableId,
      checks: checksSeen(accounts),
      plan: { kind: 'accounts', accounts: planForMove(accounts, saleItemId, targetIndex) },
    });
  };

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const body = stateQuery.isLoading ? (
    <p className="text-sm text-fg3" role="status">
      {t('restaurants:split.loading')}
    </p>
  ) : stateQuery.isError || !stateQuery.data?.service ? (
    <p className="text-sm text-danger-700" role="alert" data-testid="split-sheet-error">
      {t('restaurants:service.tableStateError')}
    </p>
  ) : (
    <>
      {inUse && (
        <p className="mb-4 text-sm text-warning-700" role="status" data-testid="split-sheet-in-use">
          {t('restaurants:server.RESTAURANT_SPLIT_CHECK_IN_USE')}
        </p>
      )}
      <div
        className="split-sheet-columns"
        style={{ ['--split-columns' as string]: String(accounts.length) }}
        aria-busy={busy}
      >
        {accounts.map((account, index) => {
          const title = accountName(account, index);
          const targets = moveTargets(index, accounts.length);
          return (
            <section
              key={account.checkId ?? `empty-${index}`}
              className="split-sheet-account"
              aria-label={title}
              data-testid="split-sheet-account"
            >
              <header className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                <h3 className="text-sm font-semibold text-fg1">{title}</h3>
                <p className="font-numeric text-xl font-bold text-fg1 tabular-nums">
                  {formatCurrency(account.total)}
                </p>
              </header>
              <ul className="flex-1 divide-y divide-line">
                {account.lines.map(line => {
                  const name =
                    line.quantity === 1
                      ? line.productName
                      : t('restaurants:splitSheet.lineName', {
                          quantity: line.quantity,
                          name: line.productName,
                        });
                  return (
                    <li key={line.saleItemId} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg1">
                        {name}
                      </span>
                      <span className="text-sm font-semibold text-fg1 tabular-nums">
                        {formatCurrency(line.total)}
                      </span>
                      {targets.map(target => {
                        const Arrow = target > index ? ArrowRight : ArrowLeft;
                        return (
                          <button
                            key={target}
                            type="button"
                            className="split-sheet-move"
                            disabled={locked}
                            onClick={() => moveLine(line.saleItemId, target)}
                            aria-label={t('restaurants:splitSheet.moveTo', {
                              name,
                              count: target + 1,
                            })}
                            data-testid="split-sheet-move"
                          >
                            <Arrow className="h-4 w-4" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </li>
                  );
                })}
              </ul>
              {onCharge && account.saleId && tableId && (
                <button
                  type="button"
                  className={index === accounts.length - 1 ? 'btn-primary' : 'btn-outline'}
                  disabled={busy}
                  onClick={() =>
                    onCharge({
                      id: account.saleId!,
                      tableId,
                      label: account.label,
                      suspendedAt: account.suspendedAt,
                      resumedDeviceId: null,
                    })
                  }
                  data-testid="split-sheet-charge"
                >
                  {t('restaurants:splitSheet.charge', { count: index + 1 })}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </>
  );

  return (
    <Modal
      isOpen={tableId !== null}
      onClose={handleClose}
      title={t('restaurants:splitSheet.title', { table: tableName })}
      size="xl"
      headerActions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline whitespace-nowrap"
            disabled={locked || !tableId || !canSplitByDiner(accounts)}
            onClick={() =>
              tableId &&
              regroup.mutate({ tableId, checks: checksSeen(accounts), plan: { kind: 'byDiner' } })
            }
            data-testid="split-sheet-by-diner"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            {t('restaurants:splitSheet.byDiner')}
          </button>
          <button
            type="button"
            className="btn-outline whitespace-nowrap"
            disabled={
              locked || accounts.length === 0 || accounts.length >= RESTAURANT_REGROUP_MAX_ACCOUNTS
            }
            onClick={() => setEmptyAccounts(current => current + 1)}
            data-testid="split-sheet-add-account"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('restaurants:splitSheet.addAccount')}
          </button>
        </div>
      }
    >
      <div data-testid="split-sheet">{body}</div>
    </Modal>
  );
}
