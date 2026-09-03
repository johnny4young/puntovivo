import { useState } from 'react';
import { CheckCircle2, FileCheck2, RotateCcw, ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { TablePagination } from '@/components/tables/TablePagination';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCalendarDay, formatDateTime } from '@/lib/utils';

type EvidenceStatus = 'pending' | 'approved' | 'consumed' | 'revoked';
type EvidenceDisplayStatus =
  EvidenceStatus | 'notYetEffective' | 'expired' | 'policyMismatch' | 'approvalInvalid';
type EvidenceFilter = EvidenceStatus | 'all';

const evidenceStatusTones: Record<
  EvidenceDisplayStatus,
  'warning' | 'success' | 'neutral' | 'danger'
> = {
  pending: 'warning',
  approved: 'success',
  consumed: 'neutral',
  revoked: 'danger',
  notYetEffective: 'warning',
  expired: 'danger',
  policyMismatch: 'danger',
  approvalInvalid: 'danger',
} as const;

const EVIDENCE_PER_PAGE = 25;

function evidenceDisplayStatus(
  evidence: {
    status: EvidenceStatus;
    countryCode: string;
    validFrom: string;
    expiresAt: string;
    policyMismatch: boolean;
    approvalErrorCode?: string | null;
  },
  businessDate: string,
  countryCode: string
): EvidenceDisplayStatus {
  if (evidence.status === 'consumed' || evidence.status === 'revoked') return evidence.status;
  if (evidence.countryCode !== countryCode || evidence.policyMismatch) return 'policyMismatch';
  if (evidence.validFrom > businessDate) return 'notYetEffective';
  if (evidence.expiresAt < businessDate) return 'expired';
  if (evidence.status === 'approved' && evidence.approvalErrorCode) return 'approvalInvalid';
  return evidence.status;
}

interface PharmacyEvidencePanelProps {
  businessDate: string;
  countryCode: string;
  canApproveEvidence?: boolean;
}

export function PharmacyEvidencePanel({
  businessDate,
  countryCode,
  canApproveEvidence = false,
}: PharmacyEvidencePanelProps) {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<EvidenceFilter>('pending');
  const [page, setPage] = useState(1);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const evidenceQuery = trpc.pharmacy.listEvidence.useQuery({
    page,
    perPage: EVIDENCE_PER_PAGE,
    ...(status !== 'all' ? { status } : {}),
  });

  async function invalidateEvidence() {
    await Promise.all([
      utils.pharmacy.listEvidence.invalidate(),
      utils.pharmacy.checkoutRequirements.invalidate(),
    ]);
  }

  const approve = useCriticalMutation('pharmacy.approveEvidence', {
    onSuccess: async () => {
      await invalidateEvidence();
      toast.success({ title: t('pharmacy:evidence.toast.approved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:evidence.toast.error' }),
  });
  const revoke = useCriticalMutation('pharmacy.revokeEvidence', {
    onSuccess: async () => {
      await invalidateEvidence();
      setRevokeTargetId(null);
      setRevokeReason('');
      toast.success({ title: t('pharmacy:evidence.toast.revoked') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:evidence.toast.error' }),
  });

  const evidence = evidenceQuery.data?.items ?? [];
  const evidenceTotal = evidenceQuery.data?.total ?? evidence.length;
  const pageCount = Math.ceil(evidenceTotal / EVIDENCE_PER_PAGE);
  const displayPage = evidenceQuery.data?.page ?? page;
  const revokeTarget = evidence.find(item => item.id === revokeTargetId) ?? null;

  if (evidenceQuery.error) {
    return (
      <QueryErrorState
        title={t('pharmacy:evidence.loadError')}
        message={translateServerError(evidenceQuery.error, t, t('errors:server.unknown'))}
        onRetry={() => void evidenceQuery.refetch()}
      />
    );
  }

  return (
    <section className="card p-5" aria-labelledby="pharmacy-evidence-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700">
            <FileCheck2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="pharmacy-evidence-heading" className="font-semibold text-secondary-950">
              {t('pharmacy:evidence.title')}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-secondary-600">
              {t('pharmacy:evidence.description')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="pv-field min-w-44">
            <label className="label" htmlFor="pharmacy-evidence-status">
              {t('pharmacy:evidence.statusFilter')}
            </label>
            <select
              id="pharmacy-evidence-status"
              className="pv-input"
              value={status}
              onChange={event => {
                setStatus(event.target.value as EvidenceFilter);
                setPage(1);
                setRevokeTargetId(null);
                setRevokeReason('');
              }}
            >
              <option value="pending">{t('pharmacy:common.evidenceStatus.pending')}</option>
              <option value="approved">{t('pharmacy:common.evidenceStatus.approved')}</option>
              <option value="consumed">{t('pharmacy:common.evidenceStatus.consumed')}</option>
              <option value="revoked">{t('pharmacy:common.evidenceStatus.revoked')}</option>
              <option value="all">{t('pharmacy:common.allStatuses')}</option>
            </select>
          </div>
          <Button variant="outline" size="compact" onClick={() => void evidenceQuery.refetch()}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:common.refresh')}
          </Button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-primary-100 bg-primary-50/50 p-3 text-xs text-primary-900">
        {t('pharmacy:evidence.privacyNote')}
      </div>
      {!canApproveEvidence && (
        <div
          className="mt-3 rounded-2xl border border-warning-200 bg-warning-50 p-3 text-xs text-warning-950"
          data-testid="pharmacy-evidence-approval-unavailable"
        >
          {t('pharmacy:evidence.approvalUnavailable')}
        </div>
      )}

      {evidenceQuery.isLoading && (
        <p className="mt-5 text-sm text-secondary-600" role="status">
          {t('pharmacy:common.loading')}
        </p>
      )}
      {!evidenceQuery.isLoading && evidence.length === 0 && (
        <EmptyState
          className="mt-5"
          icon={FileCheck2}
          title={t('pharmacy:evidence.emptyTitle')}
          description={t('pharmacy:evidence.emptyDescription')}
        />
      )}

      {evidence.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-secondary-500">
              <tr>
                <th className="px-3 py-2">{t('pharmacy:evidence.columns.medicine')}</th>
                <th className="px-3 py-2">{t('pharmacy:evidence.columns.customer')}</th>
                <th className="px-3 py-2">{t('pharmacy:evidence.columns.quantity')}</th>
                <th className="px-3 py-2">{t('pharmacy:evidence.columns.validity')}</th>
                <th className="px-3 py-2">{t('pharmacy:evidence.columns.status')}</th>
                <th className="px-3 py-2 text-right">{t('pharmacy:evidence.columns.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {evidence.map(item => {
                const displayStatus = evidenceDisplayStatus(item, businessDate, countryCode);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-3">
                      <p className="font-medium text-secondary-900">{item.productName}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-secondary-500">{item.id}</p>
                    </td>
                    <td className="px-3 py-3">{item.customerName}</td>
                    <td className="px-3 py-3">
                      {t('pharmacy:evidence.quantitySummary', {
                        dispensed: item.dispensedQuantity,
                        authorized: item.authorizedQuantity,
                      })}
                    </td>
                    <td className="px-3 py-3">
                      <p>{formatCalendarDay(item.validFrom)}</p>
                      <p className="text-xs text-secondary-500">
                        {t('pharmacy:evidence.until', {
                          date: formatCalendarDay(item.expiresAt),
                        })}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={evidenceStatusTones[displayStatus]}>
                        {t(`pharmacy:common.evidenceStatus.${displayStatus}`)}
                      </Badge>
                      <p className="mt-1 text-[11px] text-secondary-500">
                        {formatDateTime(item.createdAt)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        {canApproveEvidence &&
                          ((item.status === 'pending' && displayStatus === 'pending') ||
                            (item.status === 'approved' &&
                              displayStatus === 'approvalInvalid')) && (
                            <Button
                              variant="success"
                              size="compact"
                              disabled={approve.isPending}
                              onClick={() => approve.mutate({ id: item.id })}
                            >
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              {t(
                                displayStatus === 'approvalInvalid'
                                  ? 'pharmacy:evidence.reapprove'
                                  : 'pharmacy:evidence.approve'
                              )}
                            </Button>
                          )}
                        {(item.status === 'pending' || item.status === 'approved') && (
                          <Button
                            variant="outline"
                            size="compact"
                            disabled={revoke.isPending}
                            onClick={() => {
                              setRevokeTargetId(item.id);
                              setRevokeReason('');
                            }}
                          >
                            <ShieldX className="h-4 w-4" aria-hidden="true" />
                            {t('pharmacy:evidence.revoke')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3">
        <TablePagination
          page={displayPage - 1}
          pageCount={pageCount}
          total={evidenceTotal}
          rangeStart={(displayPage - 1) * EVIDENCE_PER_PAGE + 1}
          rangeEnd={Math.min(displayPage * EVIDENCE_PER_PAGE, evidenceTotal)}
          onPageChange={nextPage => {
            setPage(nextPage + 1);
            setRevokeTargetId(null);
            setRevokeReason('');
          }}
        />
      </div>

      {revokeTarget && (
        <div className="mt-5 rounded-2xl border border-danger-200 bg-danger-50 p-4">
          <h4 className="font-medium text-danger-950">
            {t('pharmacy:evidence.revokeTitle', { medicine: revokeTarget.productName })}
          </h4>
          <label className="label mt-3" htmlFor="pharmacy-evidence-revoke-reason">
            {t('pharmacy:common.reason')}
          </label>
          <textarea
            id="pharmacy-evidence-revoke-reason"
            className="pv-input mt-1 min-h-20"
            value={revokeReason}
            maxLength={500}
            onChange={event => setRevokeReason(event.target.value)}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setRevokeTargetId(null);
                setRevokeReason('');
              }}
            >
              {t('pharmacy:common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={revokeReason.trim().length < 3 || revoke.isPending}
              onClick={() => revoke.mutate({ id: revokeTarget.id, reason: revokeReason.trim() })}
            >
              {t('pharmacy:evidence.confirmRevoke')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
