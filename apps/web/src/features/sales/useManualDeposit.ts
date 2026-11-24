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
 *   the same tender stay visible.
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

/** Everything the dialog needs; the owner passes this object straight through. */
export interface ManualDepositController {
  /** False for a role the server would reject; the dialog then stays read-only. */
  canDeposit: boolean;
  isSubmitting: boolean;
  /** Localized failure of the last attempt, cleared when a new one starts. */
  error: string | null;
  /** Last answer the server gave for THIS tender, or null before the first one. */
  result: ManualDepositResult | null;
  history: ManualDepositHistory;
  submit: (values: ManualDepositValues) => void;
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

function tenderKey(tender: ManualDepositTender): string {
  return `${tender.saleId}:${tender.salePaymentId}`;
}

export function useManualDeposit({
  siteId,
  tender,
  enabled = true,
  onDeposited,
}: UseManualDepositParams): ManualDepositController {
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

  const historyQuery = trpc.payments.pendingTransfers.useQuery(
    { siteId, limit: HISTORY_LIMIT },
    { enabled: enabled && siteId.length > 0 }
  );

  const mutation = trpc.payments.registerManualDeposit.useMutation({
    onSuccess: answer => {
      // Rendered as-is: accumulated applied amount, surplus and status are the
      // server's verdict, so nothing here is recomputed or capped.
      setOutcome({ key, result: answer, error: null });
      void utils.payments.pendingTransfers.invalidate();
      void utils.payments.transferReconciliation.invalidate();
      void onDeposited?.(answer);
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

  return {
    canDeposit,
    isSubmitting: mutation.isPending,
    error: current.error,
    result: current.result,
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
