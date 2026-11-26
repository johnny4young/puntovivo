/**
 * Manual deposit (abono) controller for transfer tenders — Fase 5.5 / T3.
 *
 * One deposit is one call to `payments.registerManualDeposit`, which the
 * server guards with `managerOrAdminProcedure`. The hook owns three things:
 *
 * - the permission gate, mirroring the server's role requirement (hiding the
 *   button is not authorisation — the server re-checks it);
 * - the exact amount the operator verified, sent verbatim with its bank
 *   reference, value date and note. No deposit is ever summed, capped or
 *   declared "fully received" here: `appliedAmount` and `status` come back
 *   from the server and are the only authority on how much of the tender is
 *   covered;
 * - the movement history, read from the server through `pendingTransfers`
 *   (never accumulated from what this session sent) and scoped to the sale
 *   the dialog was opened for, so partial deposits and several movements on
 *   the same tender stay visible;
 * - the tender's *current* state, which only ever comes from a read that
 *   started after the last submit (S12). The mutation's answer is the outcome
 *   recorded for that movement; on an idempotent replay the server returns the
 *   outcome stored back then, which can be older than today's balance, so the
 *   hook never presents it as the tender's state.
 *
 * The component layer stays presentational (`ManualDepositDialog`) so the
 * register/cashier flow and the reconciliation subsection can share it.
 *
 * @module features/sales/useManualDeposit
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { canAccessRole, managerOrAdminRoles } from '@/features/auth/roleAccess';
import { generateUuid } from '@/lib/commandEnvelope';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';

/** The transfer tender the deposit is applied to, as the server recorded it. */
export interface ManualDepositTender {
  saleId: string;
  salePaymentId: string;
  /** `sale_payments.amount`: what the sale expects on this tender. */
  expectedAmount: number;
  saleNumber?: string | null | undefined;
  /** Reference the customer reported for the transfer, if any. */
  reference?: string | null | undefined;
  confirmationStatus?: string | null | undefined;
  /**
   * Frozen destination recorded with the tender. The deposit procedure does
   * not take a destination, so this is context for the operator, not input.
   */
  destination?: { id: string; label: string; kind: string } | null | undefined;
  /** Presentation this tender is linked to, when the sale has one. */
  presentationId?: string | null | undefined;
}

/** What the operator verified against the bank statement. */
export interface ManualDepositValues {
  reference: string;
  verifiedAmount: number;
  valueDate: string;
  note: string;
}

/**
 * Exactly what `payments.registerManualDeposit` answered. `appliedAmount` is
 * the amount accumulated on this tender, not the amount of the last call.
 */
export interface ManualDepositResult {
  appliedAmount: number;
  surplusAmount: number;
  status: string;
}

/**
 * One row of the server's transfer history. `appliedAmount` / `surplusAmount`
 * are additive and optional: until the server sends them the row still renders.
 */
export interface ManualDepositHistoryRow {
  salePaymentId: string;
  saleId: string;
  saleNumber: string | null;
  amount: number;
  reference: string | null;
  confirmationStatus: string | null;
  confirmedAt: string | null;
  createdAt: string;
  appliedAmount?: number | undefined;
  surplusAmount?: number | undefined;
}

export interface ManualDepositHistory {
  rows: ManualDepositHistoryRow[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Where the tender's *current* state stands (S12).
 *
 * - `idle`: no read was requested yet (the owner has reads disabled).
 * - `loading`: a read is in flight — including the re-read a submit triggers,
 *   during which neither the previous row nor the mutation's answer is shown.
 * - `ready`: a completed read returned this tender; the numbers are that row's.
 * - `absent`: a completed read does not carry this tender any more (it settled
 *   out of the pending list), so no balance is shown.
 * - `notRefreshed`: the read failed, so the last numbers are *not* live and are
 *   withheld instead of being reused.
 */
export type ManualDepositCurrentPhase = 'idle' | 'loading' | 'ready' | 'absent' | 'notRefreshed';

/** The tender's current state, derived only from the fresh server read. */
export interface ManualDepositCurrentState {
  phase: ManualDepositCurrentPhase;
  /** Accumulated applied amount of the read row; null unless `phase` is ready. */
  appliedAmount: number | null;
  /** Accumulated surplus of the read row; null unless `phase` is ready. */
  surplusAmount: number | null;
  /** Confirmation status of the read row; null unless `phase` is ready. */
  confirmationStatus: string | null;
  /** True while any read of the tender list is running. */
  isFetching: boolean;
  /** Why the current state is not available; null unless `phase` failed. */
  error: string | null;
  refetch: () => void;
}

/** Everything the dialog needs; the owner passes this object straight through. */
export interface ManualDepositController {
  /** False for a role the server would reject; the dialog then stays read-only. */
  canDeposit: boolean;
  isSubmitting: boolean;
  /** Localized failure of the last attempt, cleared when a new one starts. */
  error: string | null;
  /**
   * The answer `registerManualDeposit` gave for THIS tender: the outcome
   * recorded for that movement, never the tender's balance (S12).
   */
  result: ManualDepositResult | null;
  /**
   * What the tender owes now, from a read that started after the last submit.
   * Optional only so an existing caller can build a partial controller;
   * `useManualDeposit` always returns it.
   */
  currentState?: ManualDepositCurrentState | undefined;
  history: ManualDepositHistory;
  submit: (values: ManualDepositValues) => void;
}

/**
 * What `useManualDeposit` returns. The fresh read is always present here, so a
 * surface wired to the hook never has to guess whether the tender's current
 * state is available; `ManualDepositController` keeps it optional only so an
 * existing caller can build a partial controller.
 */
export interface ManualDepositControllerWithState extends ManualDepositController {
  currentState: ManualDepositCurrentState;
}

export interface UseManualDepositParams {
  siteId: string;
  tender: ManualDepositTender;
  /** Owner-controlled read gate; a closed dialog should not query. */
  enabled?: boolean;
  onDeposited?: (result: ManualDepositResult) => void | Promise<void>;
}

/** Server page cap for the history read (`pendingTransfersInput.limit` max). */
const HISTORY_LIMIT = 200;

interface DepositOutcome {
  /** Tender the outcome belongs to; a different target never inherits it. */
  key: string;
  result: ManualDepositResult | null;
  error: string | null;
}

/**
 * Progress of the read a submit asks for. `rereading` starts the moment the
 * server answers and only clears once the read it triggered has settled, so
 * the surface cannot briefly fall back to numbers recorded before the deposit.
 */
interface DepositReread {
  key: string;
  phase: 'idle' | 'rereading' | 'failed';
}

function tenderKey(tender: ManualDepositTender): string {
  return `${tender.saleId}:${tender.salePaymentId}`;
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function useManualDeposit({
  siteId,
  tender,
  enabled = true,
  onDeposited,
}: UseManualDepositParams): ManualDepositControllerWithState {
  const { t } = useTranslation('transferDeposits');
  const { user } = useAuth();
  const utils = trpc.useUtils();
  // The procedure is `managerOrAdminProcedure`; a cashier must not be offered
  // an action the server will refuse.
  const canDeposit = canAccessRole(user?.role, managerOrAdminRoles);
  const key = tenderKey(tender);
  const [outcome, setOutcome] = useState<DepositOutcome>({ key, result: null, error: null });
  const current: DepositOutcome =
    outcome.key === key ? outcome : { key, result: null, error: null };
  const [reread, setReread] = useState<DepositReread>({ key, phase: 'idle' });
  const fresh: DepositReread = reread.key === key ? reread : { key, phase: 'idle' };

  const historyQuery = trpc.payments.pendingTransfers.useQuery(
    { siteId, limit: HISTORY_LIMIT },
    { enabled: enabled && siteId.length > 0 }
  );

  /**
   * Re-reads the two reads this hook already depends on. The mutations' answer
   * is never stored as state here: until this resolves the tender's balance is
   * unknown, and if it fails the balance stays withheld rather than reusing
   * the numbers the reader could not refresh (S12).
   */
  const rereadTender = async (): Promise<void> => {
    setReread({ key, phase: 'rereading' });
    try {
      await Promise.all([
        utils.payments.pendingTransfers.invalidate(),
        utils.payments.transferReconciliation.invalidate(),
      ]);
      setReread({ key, phase: 'idle' });
    } catch {
      // The query's own error state carries the reason; this only keeps the
      // phase honest so stale numbers are never presented as current.
      setReread({ key, phase: 'failed' });
    }
  };

  const mutation = trpc.payments.registerManualDeposit.useMutation({
    onSuccess: answer => {
      // Kept as the record of THIS movement: accumulated applied amount,
      // surplus and status are the server's verdict for that deposit, so
      // nothing here is recomputed or capped. It is not the tender's balance.
      setOutcome({ key, result: answer, error: null });
      void onDeposited?.(answer);
      // The previous read predates the deposit, so the current state is
      // unknown from here until a read that started after it settles.
      void rereadTender();
    },
    onError: error => {
      setOutcome(previous => ({
        key,
        result: previous.key === key ? previous.result : null,
        error: translateServerError(error, t, t('errors.failed')),
      }));
    },
  });

  const submit = (values: ManualDepositValues) => {
    if (!canDeposit || mutation.isPending) return;
    if (!Number.isFinite(values.verifiedAmount) || values.verifiedAmount <= 0) return;
    // A new attempt drops the previous error but keeps the last server answer
    // until the server replaces it.
    setOutcome(previous => ({
      key,
      result: previous.key === key ? previous.result : null,
      error: null,
    }));
    mutation.mutate({
      siteId,
      saleId: tender.saleId,
      salePaymentId: tender.salePaymentId,
      // Exactly what the operator verified. The server accumulates and decides
      // the confirmation status; the client never adds deposits up.
      verifiedAmount: values.verifiedAmount,
      ...(values.reference.trim().length > 0 ? { reference: values.reference.trim() } : {}),
      ...(values.valueDate.trim().length > 0 ? { valueDate: values.valueDate.trim() } : {}),
      ...(values.note.trim().length > 0 ? { note: values.note.trim() } : {}),
      idempotencyKey: generateUuid(),
    });
  };

  const rows: ManualDepositHistoryRow[] = (historyQuery.data ?? []).filter(
    row => row.saleId === tender.saleId
  );

  // The fresh row for the selected tender, if the readable list still carries
  // it. Settled tenders leave that list, which is itself information.
  const tenderRow = (historyQuery.data ?? []).find(
    row => row.salePaymentId === tender.salePaymentId && row.saleId === tender.saleId
  );
  const readFailed = fresh.phase === 'failed' || historyQuery.isError;
  const phase: ManualDepositCurrentPhase = readFailed
    ? 'notRefreshed'
    : fresh.phase === 'rereading' || historyQuery.isLoading
      ? 'loading'
      : tenderRow
        ? 'ready'
        : historyQuery.data !== undefined
          ? 'absent'
          : 'idle';
  const currentState: ManualDepositCurrentState = {
    phase,
    appliedAmount: phase === 'ready' ? finiteOrNull(tenderRow?.appliedAmount) : null,
    surplusAmount: phase === 'ready' ? finiteOrNull(tenderRow?.surplusAmount) : null,
    confirmationStatus: phase === 'ready' ? (tenderRow?.confirmationStatus ?? null) : null,
    isFetching: historyQuery.isFetching,
    error:
      phase === 'notRefreshed'
        ? translateServerError(historyQuery.error, t, t('state.notRefreshed'))
        : null,
    refetch: () => {
      void rereadTender();
    },
  };

  return {
    canDeposit,
    isSubmitting: mutation.isPending,
    error: current.error,
    result: current.result,
    currentState,
    history: {
      rows,
      isLoading: historyQuery.isLoading,
      isError: historyQuery.isError,
      refetch: () => {
        void historyQuery.refetch();
      },
    },
    submit,
  };
}
