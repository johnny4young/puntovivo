/**
 * Two or more accounts of one table side by side. Each arrow, «Por comensal»
 * and the first plate sent to «Otra cuenta» apply at once on the server, so
 * the columns always show the checks the register will charge.
 */
import { useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Divide, Plus, Share2, Users } from 'lucide-react';

import { RESTAURANT_REGROUP_MAX_ACCOUNTS } from '@puntovivo/shared/restaurant-split';
import { MANAGER_OR_ADMIN_ROLES } from '@puntovivo/shared/roles';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { AuthContext } from '@/features/auth/AuthContext';
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
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const utils = trpc.useUtils();
  const [emptyAccounts, setEmptyAccounts] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [equalParts, setEqualParts] = useState(2);
  const [shareLineTarget, setShareLineTarget] = useState<{
    saleItemId: string;
    productName: string;
    sourceCheckId: string;
    shares: number;
  } | null>(null);
  const canRegroup = !user?.role || MANAGER_OR_ADMIN_ROLES.some(role => role === user.role);
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
  const splitEqual = useCriticalMutation('restaurantServices.splitEqual', {
    onSuccess: async (_data, variables) => {
      setOrder([]);
      setEmptyAccounts(0);
      toast.success({
        title: t('restaurants:splitSheet.equalSuccess', { count: variables.parts }),
      });
      await invalidateCommittedGroups(utils, [
        u => u.sales.listDrafts,
        ...RESTAURANT_TABLE_INVALIDATIONS,
      ]);
    },
    onError: error => {
      showError(error);
      if (tableId) void utils.restaurantServices.getTableState.invalidate({ tableId });
    },
  });
  const splitSharedLine = useCriticalMutation('restaurantServices.splitSharedLine', {
    onSuccess: async (_data, variables) => {
      setShareLineTarget(null);
      toast.success({
        title: t('restaurants:splitSheet.shareDishSuccess', {
          count: variables.targetCheckIds.length,
        }),
      });
      await invalidateCommittedGroups(utils, [
        u => u.sales.listDrafts,
        ...RESTAURANT_TABLE_INVALIDATIONS,
      ]);
    },
    onError: error => {
      showError(error);
      if (tableId) void utils.restaurantServices.getTableState.invalidate({ tableId });
    },
  });

  const accounts = useMemo(
    () => splitAccountsFromTableState(stateQuery.data, emptyAccounts, order),
    [stateQuery.data, emptyAccounts, order]
  );
  const openRealChecks = accounts.filter(
    (account): account is SplitAccount & { checkId: string; version: number } =>
      account.checkId !== null && account.version !== null
  );
  const primaryCheck = openRealChecks[0] ?? null;
  const maxEqualParts = Math.max(
    2,
    RESTAURANT_REGROUP_MAX_ACCOUNTS - Math.max(0, openRealChecks.length - 1)
  );
  // The server refuses any regroup while a register holds one of the checks.
  const inUse = accounts.some(account => account.checkId !== null && account.suspendedAt === null);
  const busy = regroup.isPending || splitEqual.isPending || splitSharedLine.isPending;
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
    if (!tableId || locked || !canRegroup) return;
    if (order.length === 0) {
      setOrder(accounts.flatMap(account => (account.checkId ? [account.checkId] : [])));
    }
    regroup.mutate({
      tableId,
      checks: checksSeen(accounts),
      plan: { kind: 'accounts', accounts: planForMove(accounts, saleItemId, targetIndex) },
    });
  };

  const handleEqualSplit = () => {
    if (!tableId || locked || !primaryCheck) return;
    const clampedParts = Math.max(2, Math.min(maxEqualParts, equalParts));
    splitEqual.mutate({
      tableId,
      checkId: primaryCheck.checkId,
      expectedCheckVersion: primaryCheck.version,
      parts: clampedParts,
    });
  };

  const handleConfirmSharedLine = () => {
    if (!tableId || locked || !shareLineTarget) return;
    const otherCheckIds = openRealChecks
      .map(c => c.checkId)
      .filter(id => id !== shareLineTarget.sourceCheckId);
    const targetCheckIds: Array<string | null> = [shareLineTarget.sourceCheckId];
    for (let i = 1; i < shareLineTarget.shares; i += 1) {
      targetCheckIds.push(otherCheckIds[i - 1] ?? null);
    }
    splitSharedLine.mutate({
      tableId,
      checks: checksSeen(accounts),
      saleItemId: shareLineTarget.saleItemId,
      targetCheckIds,
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
      {primaryCheck && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3"
          data-testid="split-sheet-equal-bar"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg1">
              <Divide className="h-4 w-4 text-primary-700" aria-hidden="true" />
              {t('restaurants:splitSheet.equalSplitLabel')}
            </span>
            <label className="flex items-center gap-2 text-xs font-medium text-fg2">
              {t('restaurants:splitSheet.equalParts')}
              <input
                type="number"
                min={2}
                max={maxEqualParts}
                step={1}
                className="input h-9 w-16 text-center text-sm tabular-nums"
                value={equalParts}
                disabled={locked}
                onChange={event => {
                  const next = Number(event.target.value);
                  setEqualParts(
                    Number.isFinite(next)
                      ? Math.max(2, Math.min(maxEqualParts, Math.trunc(next)))
                      : 2
                  );
                }}
                data-testid="split-sheet-equal-parts"
              />
            </label>
            <span className="text-sm text-fg2 tabular-nums">
              {t('restaurants:splitSheet.equalPerPerson')}:{' '}
              <strong className="text-fg1">
                {formatCurrency(primaryCheck.total / Math.max(2, equalParts))}
              </strong>
            </span>
          </div>
          <button
            type="button"
            className="btn-primary min-h-9 text-sm"
            disabled={locked || openRealChecks.length >= RESTAURANT_REGROUP_MAX_ACCOUNTS}
            onClick={handleEqualSplit}
            data-testid="split-sheet-equal-apply"
          >
            {t('restaurants:splitSheet.equalApply', { count: Math.max(2, equalParts) })}
          </button>
        </div>
      )}

      {shareLineTarget && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50/40 px-4 py-3"
          data-testid="split-sheet-share-bar"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-fg1">
              {t('restaurants:splitSheet.shareDishTitle')}: {shareLineTarget.productName}
            </span>
            <label className="flex items-center gap-2 text-xs font-medium text-fg2">
              {t('restaurants:splitSheet.shareDishParts')}
              <input
                type="number"
                min={2}
                max={10}
                step={1}
                className="input h-9 w-16 text-center text-sm tabular-nums"
                value={shareLineTarget.shares}
                disabled={locked}
                onChange={event => {
                  const next = Number(event.target.value);
                  setShareLineTarget(current =>
                    current
                      ? {
                          ...current,
                          shares: Number.isFinite(next)
                            ? Math.max(2, Math.min(10, Math.trunc(next)))
                            : 2,
                        }
                      : null
                  );
                }}
                data-testid="split-sheet-share-parts"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline min-h-9 text-xs"
              disabled={busy}
              onClick={() => setShareLineTarget(null)}
            >
              {t('common:actions.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary min-h-9 text-xs"
              disabled={locked}
              onClick={handleConfirmSharedLine}
              data-testid="split-sheet-share-confirm"
            >
              {t('restaurants:splitSheet.shareDishConfirm')}
            </button>
          </div>
        </div>
      )}

      <div
        className="split-sheet-columns"
        style={{ ['--split-columns' as string]: String(accounts.length) }}
        aria-busy={busy}
      >
        {accounts.map((account, index) => {
          const title = accountName(account, index);
          const targets = canRegroup ? moveTargets(index, accounts.length) : [];
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
                    <li key={line.saleItemId} className="flex items-center gap-2 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg1">
                        {name}
                      </span>
                      <span className="text-sm font-semibold text-fg1 tabular-nums">
                        {formatCurrency(line.total)}
                      </span>
                      {account.checkId && (
                        <button
                          type="button"
                          className="btn-ghost btn-icon h-8 w-8 shrink-0 text-fg3 hover:text-primary-700"
                          disabled={locked}
                          aria-label={t('restaurants:splitSheet.shareDishAria', { name })}
                          title={t('restaurants:splitSheet.shareDish')}
                          onClick={() =>
                            setShareLineTarget({
                              saleItemId: line.saleItemId,
                              productName: name,
                              sourceCheckId: account.checkId!,
                              shares: 2,
                            })
                          }
                          data-testid="split-sheet-share-dish"
                        >
                          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
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
        canRegroup ? (
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
                locked ||
                accounts.length === 0 ||
                accounts.length >= RESTAURANT_REGROUP_MAX_ACCOUNTS
              }
              onClick={() => setEmptyAccounts(current => current + 1)}
              data-testid="split-sheet-add-account"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('restaurants:splitSheet.addAccount')}
            </button>
          </div>
        ) : undefined
      }
    >
      <div data-testid="split-sheet">{body}</div>
    </Modal>
  );
}
