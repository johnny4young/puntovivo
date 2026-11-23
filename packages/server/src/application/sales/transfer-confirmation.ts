/**
 * Transfer confirmation domain (design V3.3).
 *
 * Three concepts stay separate by design:
 *   - the tender's confirmation STATE (what happened to this payment);
 *   - the confirmation SOURCE (how it was obtained);
 *   - the ACTOR (recorded in the immutable audit chain, never inferred).
 *
 * The financial rules implemented here are the ones a POS must never get
 * wrong: reported money is not received money, a superseded tender stops
 * counting for everything, and the active tenders must keep adding up to the
 * sale total so the existing sum invariant keeps holding.
 *
 * @module application/sales/transfer-confirmation
 */
import { roundMoney } from '../../lib/money.js';
import type {
  TransferConfirmationSource,
  TransferConfirmationStatus,
} from '../../db/schema/base.js';

/** Every transfer tender created after migration 0108 starts here. */
export const INITIAL_TRANSFER_STATUS: TransferConfirmationStatus = 'pending';

/** Confirmations that count as received money. */
const CONFIRMED_STATUSES: ReadonlySet<TransferConfirmationStatus> = new Set([
  'manual_confirmed',
  'provider_confirmed',
]);

/** Tenders that still count toward the sale total (sum invariant). */
const SUPERSEDED_STATUSES: ReadonlySet<TransferConfirmationStatus> = new Set([
  'rejected',
  'cancelled',
]);

/**
 * A NULL status is a pre-migration transfer: it predates the lifecycle and
 * keeps the historical behaviour (counted as received). Every transfer
 * created after 0108 is written with an explicit 'pending', so NULL can only
 * ever mean "historical".
 */
export function isTransferConfirmed(
  status: TransferConfirmationStatus | null | undefined
): boolean {
  if (status == null) return true;
  return CONFIRMED_STATUSES.has(status);
}

/** Replaced tenders leave every calculation but stay visible forever. */
export function isTransferSuperseded(
  status: TransferConfirmationStatus | null | undefined
): boolean {
  if (status == null) return false;
  return SUPERSEDED_STATUSES.has(status);
}

/** Tenders waiting for reconciliation: they complete the total, not the money. */
export function isTransferAwaitingConfirmation(
  status: TransferConfirmationStatus | null | undefined
): boolean {
  if (status == null) return false;
  return !CONFIRMED_STATUSES.has(status) && !SUPERSEDED_STATUSES.has(status);
}

/**
 * Allowed transitions. `manual_confirmed` and `provider_confirmed` are
 * terminal for normal mutations: reversals go through the returns flow.
 * A rejected/cancelled tender can be reopened by an authentic late provider
 * verdict, but only into reconciliation — never straight into confirmation.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<TransferConfirmationStatus, readonly TransferConfirmationStatus[]>
> = {
  pending: [
    'customer_reported',
    'manual_confirmed',
    'provider_confirmed',
    'needs_reconciliation',
    'cancelled',
  ],
  customer_reported: [
    'manual_confirmed',
    'provider_confirmed',
    'rejected',
    'needs_reconciliation',
  ],
  needs_reconciliation: ['manual_confirmed', 'provider_confirmed', 'rejected'],
  // Late authentic verdicts reopen into reconciliation for human review.
  rejected: ['needs_reconciliation'],
  cancelled: ['needs_reconciliation'],
  manual_confirmed: [],
  provider_confirmed: [],
};

export interface TransitionCheck {
  allowed: boolean;
  reason?: 'same_state' | 'terminal' | 'not_permitted';
}

/**
 * Whether a tender may move from `from` (NULL = historical transfer, which
 * behaves like a confirmed row and therefore has no outgoing transition) to
 * `to`.
 */
export function canTransition(
  from: TransferConfirmationStatus | null | undefined,
  to: TransferConfirmationStatus
): TransitionCheck {
  if (from == null) {
    return { allowed: false, reason: 'terminal' };
  }
  if (from === to) {
    return { allowed: false, reason: 'same_state' };
  }
  const next = ALLOWED_TRANSITIONS[from];
  if (next.length === 0) {
    return { allowed: false, reason: 'terminal' };
  }
  return next.includes(to) ? { allowed: true } : { allowed: false, reason: 'not_permitted' };
}

/** A source is only ever legal together with an effective confirmation. */
export function isValidConfirmationSource(
  status: TransferConfirmationStatus,
  source: TransferConfirmationSource | null | undefined
): boolean {
  return isTransferConfirmed(status) ? source != null : source == null;
}

/** Minimal shape this module needs from a tender row. */
export interface TenderForSums {
  method: string;
  amount: number;
  confirmationStatus?: TransferConfirmationStatus | null;
}

export interface TenderSums {
  /** Σ active tenders — must equal the sale total. */
  activeTotal: number;
  /** Σ money actually received (confirmed transfers + every non-transfer). */
  receivedTotal: number;
  /** Σ transfers still awaiting reconciliation. */
  awaitingTotal: number;
  /** Σ superseded tenders, excluded from both sums above. */
  supersededTotal: number;
}

/**
 * Compute the four financial aggregates from one sale's tenders.
 *
 * Non-transfer methods are always received (cash, card, credit are settled by
 * their own rules). Transfers depend on the confirmation lifecycle.
 */
export function sumSaleTenders(tenders: readonly TenderForSums[]): TenderSums {
  let activeTotal = 0;
  let receivedTotal = 0;
  let awaitingTotal = 0;
  let supersededTotal = 0;

  for (const tender of tenders) {
    const amount = roundMoney(tender.amount);
    const isTransfer = tender.method === 'transfer';

    if (isTransfer && isTransferSuperseded(tender.confirmationStatus)) {
      supersededTotal = roundMoney(supersededTotal + amount);
      continue;
    }

    activeTotal = roundMoney(activeTotal + amount);

    if (!isTransfer) {
      receivedTotal = roundMoney(receivedTotal + amount);
      continue;
    }

    if (isTransferConfirmed(tender.confirmationStatus)) {
      receivedTotal = roundMoney(receivedTotal + amount);
    } else {
      awaitingTotal = roundMoney(awaitingTotal + amount);
    }
  }

  return { activeTotal, receivedTotal, awaitingTotal, supersededTotal };
}

/**
 * Initial confirmation state for a tender captured at sale creation.
 *
 * Preserving today's behaviour is a hard requirement: before the lifecycle
 * existed, a transfer tender was written and immediately counted as received,
 * because the cashier had already looked at the store account and typed the
 * reference they saw. Exactly that case keeps its meaning — a transfer with an
 * operator-supplied reference is born `manual_confirmed`, attributed to the
 * cashier who entered it. A transfer *without* a reference was never verified
 * by anyone, so it is born `pending` and stays out of `received` until a human
 * or a provider confirms it.
 *
 * Every other method returns `null`: the lifecycle is transfer-only, and the
 * column is CHECKed to stay NULL for them.
 */
export function resolveInitialTransferState(args: {
  method: string;
  reference?: string | null | undefined;
}): {
  confirmationStatus: TransferConfirmationStatus | null;
  confirmationSource: TransferConfirmationSource | null;
  /** Only set for an effective confirmation; the caller supplies the actor. */
  isConfirmedAtCreation: boolean;
} {
  if (args.method !== 'transfer') {
    return { confirmationStatus: null, confirmationSource: null, isConfirmedAtCreation: false };
  }
  const hasReference = (args.reference ?? '').trim().length > 0;
  if (hasReference) {
    return {
      confirmationStatus: 'manual_confirmed',
      confirmationSource: 'operator',
      isConfirmedAtCreation: true,
    };
  }
  return {
    confirmationStatus: 'pending',
    confirmationSource: null,
    isConfirmedAtCreation: false,
  };
}

/**
 * The transfer-lifecycle columns for one tender row, ready to spread into an
 * insert. One helper keeps every write point (fresh sale, completed draft,
 * split draft placeholders) on the same rule: a transfer is never written
 * with a NULL state by omission, so NULL can only ever mean "historical row
 * from before migration 0108".
 */
export function transferConfirmationColumns(args: {
  method: string;
  reference?: string | null | undefined;
  actorId: string;
  now: string;
}): {
  confirmationStatus: TransferConfirmationStatus | null;
  confirmationSource: TransferConfirmationSource | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
} {
  const state = resolveInitialTransferState({ method: args.method, reference: args.reference });
  return {
    confirmationStatus: state.confirmationStatus,
    confirmationSource: state.confirmationSource,
    confirmedBy: state.isConfirmedAtCreation ? args.actorId : null,
    confirmedAt: state.isConfirmedAtCreation ? args.now : null,
  };
}
