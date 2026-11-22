import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type TableState = inferRouterOutputs<AppRouter>['restaurantServices']['getTableState'];
type RegroupPlan = inferRouterInputs<AppRouter>['restaurantServices']['regroupChecks']['plan'];
type AccountsPlan = Extract<RegroupPlan, { kind: 'accounts' }>['accounts'];

export interface SplitLine {
  saleItemId: string;
  productName: string;
  quantity: number;
  total: number;
  /** Null shares the plate with the table. */
  seatNumber: number | null;
}

export interface SplitAccount {
  /** Null for an account opened with «Otra cuenta» that has no line yet. */
  checkId: string | null;
  saleId: string | null;
  label: string | null;
  suspendedAt: string | null;
  total: number;
  lines: SplitLine[];
  /** Seats with a plate here, ascending; null marks a shared plate. */
  seats: Array<number | null>;
}

/**
 * Open checks of the table as columns, then `emptyAccounts` columns still
 * without lines. Without `order` they read by first diner; once a move pins
 * `order`, columns keep their place and checks it does not know go last.
 */
export function splitAccountsFromTableState(
  state: TableState | undefined,
  emptyAccounts: number,
  order: readonly string[] = []
): SplitAccount[] {
  if (!state?.service) return [];
  const seatByDiner = new Map(state.diners.map(diner => [diner.id, diner.seatNumber]));
  const accounts: SplitAccount[] = state.checks.map(check => {
    const lines = check.lines.map(line => ({
      saleItemId: line.saleItemId,
      productName: line.productName,
      quantity: line.quantity,
      total: line.total,
      seatNumber: line.dinerId ? (seatByDiner.get(line.dinerId) ?? null) : null,
    }));
    return {
      checkId: check.id,
      saleId: check.saleId,
      label: check.label,
      suspendedAt: check.suspendedAt,
      total: check.total,
      lines,
      seats: seatsOf(lines),
    };
  });
  const pinned = new Map(order.map((checkId, index) => [checkId, index]));
  const position = (account: SplitAccount) =>
    order.length === 0
      ? (account.seats[0] ?? Number.MAX_SAFE_INTEGER)
      : (pinned.get(account.checkId!) ?? order.length);
  accounts.sort((a, b) => position(a) - position(b));
  for (let index = 0; index < emptyAccounts; index += 1) {
    accounts.push({
      checkId: null,
      saleId: null,
      label: null,
      suspendedAt: null,
      total: 0,
      lines: [],
      seats: [],
    });
  }
  return accounts;
}

function seatsOf(lines: readonly SplitLine[]): Array<number | null> {
  const seats = [...new Set(lines.map(line => line.seatNumber))];
  // Shared plates read last, after the diners.
  return seats.sort((a, b) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER));
}

/** The arrow sends a line to the next account; the last account sends it back. */
export function moveTargetIndex(accountIndex: number, accountCount: number): number {
  return accountIndex === accountCount - 1 ? accountIndex - 1 : accountIndex + 1;
}

/** Every line of the table in the account it should end in, after one move. */
export function planForMove(
  accounts: readonly SplitAccount[],
  saleItemId: string,
  targetIndex: number
): AccountsPlan {
  return accounts
    .map((account, index) => ({
      checkId: account.checkId,
      saleItemIds: [
        ...account.lines.map(line => line.saleItemId).filter(id => id !== saleItemId),
        ...(index === targetIndex ? [saleItemId] : []),
      ],
    }))
    .filter(account => account.checkId !== null || account.saleItemIds.length > 0);
}

/**
 * «Por comensal» needs two groups (diners, or a diner and shared plates) and is
 * pointless once every account already holds exactly one of them.
 */
export function canSplitByDiner(accounts: readonly SplitAccount[]): boolean {
  const groups = new Set(accounts.flatMap(account => account.seats));
  if (groups.size < 2) return false;
  const filled = accounts.filter(account => account.lines.length > 0);
  return !(filled.length === groups.size && filled.every(account => account.seats.length === 1));
}
