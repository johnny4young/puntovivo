/**
 * Fase 5.4 / T6 — transfer reconciliation subsection of the Payments tab.
 *
 * A subsection, not a dashboard: it mounts inside `PaymentHealthPanel` and
 * renders under the same `.card` / `.pv-kpis` / `.pv-table` recipes as the
 * panels around it. Nothing here reads or writes a table of its own — every
 * figure comes from a procedure the server already exposes:
 *
 * - tender status counts ← `payments.transferReconciliation` (`counters`);
 * - the tender rows ← the same read (`rows`), which already carry the
 *   accumulated `appliedAmount` and the `surplusAmount` per tender;
 * - presentations still open right now ← `payments.openPresentations`, one
 *   tenant-scoped read per visible site (the procedure needs a site);
 * - expired presentations and QRs that never became a sale ← the
 *   `payments.peekOutbox` window the panel already read, filtered client-side
 *   (expiry flips a presentation row to `timeout`; a link flips it to `linked`).
 *
 * Two rules keep the surface honest:
 *
 * 1. A figure the reads cannot total is rendered as *unavailable*, never as
 *    zero. When a read hits its row cap the derived totals are lower bounds,
 *    so they are withheld instead of shown as if they were complete.
 * 2. Recording money reuses the 5.5 component: the row is adapted into a
 *    `ManualDepositTender` and handed to `ManualDepositDialog` over
 *    `useManualDeposit`, so deposits, accumulation and the confirmation verdict
 *    stay server-owned. The client never sums deposits.
 *
 * @module features/operations/TransferReconciliationSection
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  CircleSlash,
  Clock,
  HandCoins,
  PackageCheck,
  QrCode,
  Scale,
  ScanLine,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

import { EmptyState } from '@/components/feedback/EmptyState';
import { TablePagination } from '@/components/tables/TablePagination';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { Badge, Button, KpiTile, StatusStrip } from '@/components/ui';
import { ManualDepositDialog } from '@/features/sales/ManualDepositDialog';
import {
  useManualDeposit,
  type ManualDepositTender,
} from '@/features/sales/useManualDeposit';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { transferConfirmationTone } from './paymentHealthPresentation';

export type TransferReconciliationRow =
  inferRouterOutputs<AppRouter>['payments']['transferReconciliation']['rows'][number];
export type PaymentOutboxRow = inferRouterOutputs<AppRouter>['payments']['peekOutbox'][number];

/**
 * Server cap of `pendingTransfersInput.limit`. Reading the whole page is what
 * makes the derived totals trustworthy: a full page means there may be more
 * tenders, so the totals are withheld instead of under-reported.
 */
export const TRANSFER_ROW_LIMIT = 200;

/** Presentation statuses that are still open or already tied to a sale. */
const PRESENTATION_OPEN_OR_LINKED = new Set(['presented', 'linked']);

export interface TransferReconciliationTotals {
  /** `customer_reported` tenders. */
  reported: number;
  /** `manual_confirmed` + `provider_confirmed` tenders. */
  confirmed: number;
  /** `rejected` tenders. */
  rejected: number;
  /** `needs_reconciliation` tenders. */
  awaitingReconciliation: number;
  /** `pending` tenders. */
  pending: number;
  /** QRs open right now, or null when that read has not resolved. */
  pendingPresentations: number | null;
  /** Presentations that expired in the outbox window, or null when truncated. */
  expiredPresentations: number | null;
  /** Presentations that ended without ever becoming a sale tender. */
  unlinkedPresentations: number | null;
  /**
   * Tenders whose deposit chain does not match the tender exactly: partially
   * applied, or applied with a surplus. The rows carry no movement count, so
   * this can never claim "more than one deposit" on its own.
   */
  partialOrMultipleDeposits: number | null;
  /** Tenders whose deposit chain left money above the tender. */
  excessTenders: number | null;
  /** Surplus received that was never applied to a sale. */
  unappliedAmount: number | null;
  /** The tender read hit its cap: the row-derived figures are lower bounds. */
  rowsTruncated: boolean;
  /** The outbox window hit its cap: the presentation figures are lower bounds. */
  outboxTruncated: boolean;
}

export interface DeriveTransferBucketsArgs {
  counters: Record<string, number>;
  rows: TransferReconciliationRow[];
  outboxRows: PaymentOutboxRow[];
  outboxLimit: number;
  pendingPresentations: number | null;
}

/**
 * Turn the procedures' answers into the reconciliation buckets.
 *
 * Pure on purpose: the surface must not invent a number, and this is the one
 * place where a figure becomes `null` (unavailable) instead of a plausible zero.
 */
export function deriveTransferBuckets({
  counters,
  rows,
  outboxRows,
  outboxLimit,
  pendingPresentations,
}: DeriveTransferBucketsArgs): TransferReconciliationTotals {
  const counter = (status: string): number => counters[status] ?? 0;

  const rowsTruncated = rows.length >= TRANSFER_ROW_LIMIT;
  const outboxTruncated = outboxRows.length >= outboxLimit;

  const presentations = outboxRows.filter(row => row.kind === 'presentation');
  const expired = presentations.filter(row => row.status === 'timeout');
  const unlinked = presentations.filter(
    row => !PRESENTATION_OPEN_OR_LINKED.has(row.status) && row.salePaymentId === null
  );

  // A deposit chain that does not match the tender exactly: short of the
  // expected amount, or over it.
  const partialOrOver = rows.filter(
    row => row.appliedAmount > 0 && (row.appliedAmount < row.amount || row.surplusAmount > 0)
  );
  const withSurplus = rows.filter(row => row.surplusAmount > 0);
  const surplusTotal = rows.reduce((total, row) => total + row.surplusAmount, 0);

  return {
    reported: counter('customer_reported'),
    confirmed: counter('manual_confirmed') + counter('provider_confirmed'),
    rejected: counter('rejected'),
    awaitingReconciliation: counter('needs_reconciliation'),
    pending: counter('pending'),
    pendingPresentations,
    expiredPresentations: outboxTruncated ? null : expired.length,
    unlinkedPresentations: outboxTruncated ? null : unlinked.length,
    partialOrMultipleDeposits: rowsTruncated ? null : partialOrOver.length,
    excessTenders: rowsTruncated ? null : withSurplus.length,
    unappliedAmount: rowsTruncated ? null : surplusTotal,
    rowsTruncated,
    outboxTruncated,
  };
}

/** A hook-safe tender used while no row is selected. */
const NO_TENDER: ManualDepositTender = { saleId: '', salePaymentId: '', expectedAmount: 0 };

/** The 5.5 contract, fed from the row the server returned. */
export function toManualDepositTender(row: TransferReconciliationRow): ManualDepositTender {
  return {
    saleId: row.saleId,
    salePaymentId: row.salePaymentId,
    expectedAmount: row.amount,
    saleNumber: row.saleNumber,
    reference: row.reference,
    confirmationStatus: row.confirmationStatus,
    destination: row.destinationSnapshot,
  };
}

export interface TransferReconciliationSectionProps {
  /**
   * Outbox rows the panel already read. Expiry and linking are recorded there,
   * so this window is the only read that can see an expired presentation.
   */
  outboxRows: PaymentOutboxRow[];
  /** Cap of that read, so a full window is never reported as a total. */
  outboxLimit: number;
}

export function TransferReconciliationSection({
  outboxRows,
  outboxLimit,
}: TransferReconciliationSectionProps): React.ReactElement {
  const { t } = useTranslation('operations');
  const [depositTargetId, setDepositTargetId] = useState<string | null>(null);

  const transferQuery = trpc.payments.transferReconciliation.useQuery(
    { limit: TRANSFER_ROW_LIMIT },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  const sitesQuery = trpc.sites.list.useQuery();
  const siteIds = useMemo(
    () => (sitesQuery.data?.items ?? []).map(site => site.id),
    [sitesQuery.data]
  );
  // `openPresentations` is site-scoped, so the tenant-wide figure is the sum of
  // the per-site reads the user is allowed to see (same fan-out as
  // DeviceHealthPanel), never a fabrication from one site.
  const presentationQueries = trpc.useQueries(builder =>
    siteIds.map(siteId => builder.payments.openPresentations({ siteId }, { staleTime: 30_000 }))
  );
  const presentationsResolved =
    sitesQuery.isSuccess && presentationQueries.every(query => query.isSuccess);
  const pendingPresentations = presentationsResolved
    ? presentationQueries.reduce((total, query) => total + (query.data?.length ?? 0), 0)
    : null;

  const rows = useMemo(() => transferQuery.data?.rows ?? [], [transferQuery.data]);
  const counters = transferQuery.data?.counters ?? {};
  const totals = deriveTransferBuckets({
    counters,
    rows,
    outboxRows,
    outboxLimit,
    pendingPresentations,
  });
  const pagination = usePaginatedRows(rows, 8);

  // The dialog is driven by the row the operator picked, resolved from the
  // current read so a refetch keeps the same tender open.
  const depositTarget = rows.find(row => row.salePaymentId === depositTargetId) ?? null;
  const depositTender = depositTarget ? toManualDepositTender(depositTarget) : NO_TENDER;
  const deposit = useManualDeposit({
    siteId: depositTarget?.siteId ?? '',
    tender: depositTender,
    enabled: depositTarget !== null && Boolean(depositTarget.siteId),
  });

  /** Counts stay numeric; a figure the reads cannot total is withheld. */
  const bucketCount = (value: number | null): string =>
    value === null ? t('payments.transfers.unavailable') : String(value);
  const unavailableHint = t('payments.transfers.truncatedHint');
  const statusLabel = (status: string | null): string =>
    status
      ? t(`payments.transfers.status.${status}`, { defaultValue: status })
      : t('payments.transfers.status.missing');

  return (
    <section className="card space-y-5 p-6" data-testid="transfer-reconciliation">
      <header>
        <p className="pv-kicker">{t('payments.transfers.kicker')}</p>
        <h3 className="pv-title text-lg">{t('payments.transfers.title')}</h3>
        <p className="mt-1 text-sm text-secondary-500">{t('payments.transfers.description')}</p>
      </header>

      {transferQuery.isLoading && (
        <p className="text-sm text-secondary-500">{t('common.loading')}</p>
      )}

      {transferQuery.error && (
        <StatusStrip
          tone="danger"
          icon={AlertTriangle}
          title={translateServerError(transferQuery.error, t, t('common.errorGeneric'))}
          role="alert"
        />
      )}

      {transferQuery.data && (
        <>
          <div className="space-y-3">
            <p className="pv-kicker">{t('payments.transfers.countersTitle')}</p>
            <div className="pv-kpis grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
              <div className="contents" data-testid="transfer-bucket-reported">
                <KpiTile
                  icon={HandCoins}
                  label={t('payments.transfers.buckets.reported')}
                  value={bucketCount(totals.reported)}
                  tone={totals.reported > 0 ? 'primary' : 'ink'}
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-confirmed">
                <KpiTile
                  icon={CheckCircle2}
                  label={t('payments.transfers.buckets.confirmed')}
                  value={bucketCount(totals.confirmed)}
                  context={t('payments.transfers.bucketHints.confirmed')}
                  tone="success"
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-rejected">
                <KpiTile
                  icon={XCircle}
                  label={t('payments.transfers.buckets.rejected')}
                  value={bucketCount(totals.rejected)}
                  tone={totals.rejected > 0 ? 'danger' : 'ink'}
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-awaitingReconciliation">
                <KpiTile
                  icon={Scale}
                  label={t('payments.transfers.buckets.awaitingReconciliation')}
                  value={bucketCount(totals.awaitingReconciliation)}
                  tone={totals.awaitingReconciliation > 0 ? 'warning' : 'success'}
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-pending">
                <KpiTile
                  icon={Clock}
                  label={t('payments.transfers.buckets.pending')}
                  value={bucketCount(totals.pending)}
                  tone="ink"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="pv-kicker">{t('payments.transfers.derivedTitle')}</p>
            <div className="pv-kpis grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              <div className="contents" data-testid="transfer-bucket-pendingPresentations">
                <KpiTile
                  icon={QrCode}
                  label={t('payments.transfers.buckets.pendingPresentations')}
                  value={bucketCount(totals.pendingPresentations)}
                  tone="primary"
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-expiredPresentations">
                <KpiTile
                  icon={CircleSlash}
                  label={t('payments.transfers.buckets.expiredPresentations')}
                  value={bucketCount(totals.expiredPresentations)}
                  context={
                    totals.expiredPresentations === null
                      ? unavailableHint
                      : t('payments.transfers.bucketHints.expiredPresentations')
                  }
                  tone={totals.expiredPresentations ? 'warning' : 'success'}
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-unlinkedPresentations">
                <KpiTile
                  icon={ScanLine}
                  label={t('payments.transfers.buckets.unlinkedPresentations')}
                  value={bucketCount(totals.unlinkedPresentations)}
                  context={
                    totals.unlinkedPresentations === null
                      ? unavailableHint
                      : t('payments.transfers.bucketHints.unlinkedPresentations')
                  }
                  tone="ink"
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-partialDeposits">
                <KpiTile
                  icon={Banknote}
                  label={t('payments.transfers.buckets.partialDeposits')}
                  value={bucketCount(totals.partialOrMultipleDeposits)}
                  context={
                    totals.partialOrMultipleDeposits === null
                      ? unavailableHint
                      : t('payments.transfers.bucketHints.partialDeposits')
                  }
                  tone="ink"
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-excess">
                <KpiTile
                  icon={AlertTriangle}
                  label={t('payments.transfers.buckets.excess')}
                  value={bucketCount(totals.excessTenders)}
                  tone={totals.excessTenders ? 'warning' : 'success'}
                />
              </div>
              <div className="contents" data-testid="transfer-bucket-unappliedAmount">
                <KpiTile
                  icon={Wallet}
                  label={t('payments.transfers.buckets.unappliedAmount')}
                  value={
                    totals.unappliedAmount === null
                      ? t('payments.transfers.unavailable')
                      : formatCurrency(totals.unappliedAmount)
                  }
                  context={
                    totals.unappliedAmount === null
                      ? unavailableHint
                      : t('payments.transfers.bucketHints.unappliedAmount')
                  }
                  tone={totals.unappliedAmount ? 'warning' : 'success'}
                  mono
                />
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title={t('payments.transfers.emptyTitle')}
              description={t('payments.transfers.emptyState')}
            />
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="pv-table">
                  <thead>
                    <tr>
                      <th>{t('payments.transfers.columns.sale')}</th>
                      <th>{t('payments.transfers.columns.reference')}</th>
                      <th className="num">{t('payments.transfers.columns.amount')}</th>
                      <th className="num">{t('payments.transfers.columns.applied')}</th>
                      <th className="num">{t('payments.transfers.columns.surplus')}</th>
                      <th>{t('payments.transfers.columns.status')}</th>
                      <th>{t('payments.transfers.columns.createdAt')}</th>
                      <th className="num">{t('payments.transfers.columns.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagination.pageRows.map(row => {
                      const noSite = !row.siteId;
                      const blocked = !deposit.canDeposit || noSite;
                      const disabledReason = !deposit.canDeposit
                        ? t('payments.transfers.actions.noPermission')
                        : noSite
                          ? t('payments.transfers.actions.noSite')
                          : undefined;
                      return (
                        <tr key={row.salePaymentId}>
                          <td>{row.saleNumber ?? '—'}</td>
                          <td className="break-all">{row.reference ?? '—'}</td>
                          <td className="num">{formatCurrency(row.amount)}</td>
                          <td className="num">{formatCurrency(row.appliedAmount)}</td>
                          <td className="num">{formatCurrency(row.surplusAmount)}</td>
                          <td>
                            <Badge
                              variant={transferConfirmationTone(row.confirmationStatus)}
                              marker="dot"
                            >
                              {statusLabel(row.confirmationStatus)}
                            </Badge>
                          </td>
                          <td className="muted">{formatDateTime(row.createdAt)}</td>
                          <td>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                type="button"
                                disabled={blocked}
                                title={disabledReason}
                                onClick={() => {
                                  if (blocked) return;
                                  setDepositTargetId(row.salePaymentId);
                                }}
                                data-testid={`transfer-deposit-${row.salePaymentId}`}
                                variant="ghost"
                              >
                                <HandCoins />
                                {t('payments.transfers.actions.deposit')}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pagination.hasPagination && (
                <TablePagination
                  page={pagination.page}
                  pageCount={pagination.pageCount}
                  total={pagination.total}
                  rangeStart={pagination.rangeStart}
                  rangeEnd={pagination.rangeEnd}
                  onPageChange={pagination.setPage}
                />
              )}
            </div>
          )}
        </>
      )}

      <ManualDepositDialog
        isOpen={depositTarget !== null}
        onClose={() => setDepositTargetId(null)}
        tender={depositTender}
        deposit={deposit}
      />
    </section>
  );
}
