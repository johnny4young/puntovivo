import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Badge, Button, StatusStrip } from '@/components/ui';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';

/** One immutable AI recommendation returned by the tenant-scoped payments router. */
type PaymentProposal = inferRouterOutputs<AppRouter>['payments']['listProposals'][number];

/** Reviewable payment evidence; the model can never settle directly. */
export function PaymentProposalSection({ isAdmin }: { isAdmin: boolean }): React.ReactElement {
  const { t } = useTranslation('operations');
  const toast = useToast();
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [providerChecked, setProviderChecked] = useState(false);
  const proposalsQuery = trpc.payments.listProposals.useQuery(
    { limit: 50, status: 'pending' },
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  const proposals = proposalsQuery.data ?? [];
  const selected = proposals.find(proposal => proposal.id === selectedId) ?? null;
  const close = () => {
    setSelectedId(null);
    setProviderChecked(false);
  };
  const reviewMutation = trpc.payments.reviewProposal.useMutation({
    onSuccess: async (_result, input) => {
      await Promise.all([
        utils.payments.listProposals.invalidate(),
        utils.payments.peekOutbox.invalidate(),
        utils.payments.reconciliation.invalidate(),
        utils.payments.methodBreakdown.invalidate(),
        utils.operations.needsAttention.invalidate(),
      ]);
      toast.success({
        title: t(
          input.decision === 'approve'
            ? 'payments.proposals.approved'
            : 'payments.proposals.rejected'
        ),
      });
      close();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'operations:payments.proposals.reviewError',
    }),
  });
  const review = (decision: 'approve' | 'reject') => {
    if (!isAdmin || !selected || (decision === 'approve' && !providerChecked)) return;
    reviewMutation.mutate({ proposalId: selected.id, decision });
  };

  return (
    <section className="card space-y-4 p-6" aria-label={t('payments.proposals.title')}>
      <header>
        <h3 className="pv-title text-lg">{t('payments.proposals.title')}</h3>
        <p className="mt-1 text-sm text-secondary-500">{t('payments.proposals.description')}</p>
      </header>
      {proposalsQuery.isLoading && (
        <p className="text-sm text-secondary-500">{t('common.loading')}</p>
      )}
      {proposalsQuery.error && (
        <StatusStrip
          tone="danger"
          icon={AlertTriangle}
          title={translateServerError(proposalsQuery.error, t, t('common.errorGeneric'))}
          role="alert"
        />
      )}
      {!proposalsQuery.isLoading && !proposalsQuery.error && proposals.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title={t('payments.proposals.emptyTitle')}
          description={t('payments.proposals.emptyDescription')}
        />
      )}
      {proposals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="pv-table">
            <thead>
              <tr>
                <th className="!min-w-0">{t('payments.proposals.rail')}</th>
                <th>{t('payments.proposals.providerReference')}</th>
                <th className="num">{t('payments.proposals.providerAmount')}</th>
                <th>{t('payments.proposals.confidence')}</th>
                <th className="num">{t('payments.proposals.action')}</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(proposal => (
                <tr key={proposal.id}>
                  <td className="!min-w-0">{t(`payments.rails.${proposal.railId}`)}</td>
                  <td className="break-all">{proposal.evidence.statement.reference}</td>
                  <td className="num">
                    {formatCurrency(
                      proposal.evidence.statement.amount,
                      proposal.evidence.statement.currencyCode
                    )}
                  </td>
                  <td>
                    <Badge variant="warning" marker="dot">
                      {t(`payments.proposals.confidenceValue.${proposal.evidence.confidence}`)}
                    </Badge>
                  </td>
                  <td className="num">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setSelectedId(proposal.id);
                        setProviderChecked(false);
                      }}
                      data-testid={`payment-proposal-review-${proposal.id}`}
                    >
                      {t('payments.proposals.review')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        isOpen={selected !== null}
        onClose={close}
        title={t('payments.proposals.reviewTitle')}
        size="lg"
        footer={
          <>
            <ModalButton onClick={close} disabled={reviewMutation.isPending}>
              {t('payments.proposals.cancel')}
            </ModalButton>
            <ModalButton
              variant="danger"
              onClick={() => review('reject')}
              disabled={!isAdmin || reviewMutation.isPending}
            >
              {t('payments.proposals.reject')}
            </ModalButton>
            <ModalButton
              variant="primary"
              onClick={() => review('approve')}
              disabled={!isAdmin || !providerChecked || reviewMutation.isPending}
            >
              {t('payments.proposals.approve')}
            </ModalButton>
          </>
        }
      >
        {selected && (
          <ProposalEvidence
            proposal={selected}
            isAdmin={isAdmin}
            providerChecked={providerChecked}
            onProviderCheckedChange={setProviderChecked}
          />
        )}
      </Modal>
    </section>
  );
}

function ProposalEvidence({
  proposal,
  isAdmin,
  providerChecked,
  onProviderCheckedChange,
}: {
  proposal: PaymentProposal;
  isAdmin: boolean;
  providerChecked: boolean;
  onProviderCheckedChange: (checked: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation('operations');
  const { statement, candidates, recommendedOutboxId, explanation } = proposal.evidence;
  const recommended = candidates.find(candidate => candidate.outboxId === recommendedOutboxId);
  const discrepancies = recommended
    ? [
        recommended.reference !== statement.reference ? 'reference' : null,
        recommended.providerTransactionId !== statement.providerTransactionId
          ? 'transaction'
          : null,
        recommended.amount !== statement.amount ? 'amount' : null,
        recommended.currencyCode !== statement.currencyCode ? 'currency' : null,
      ].filter((value): value is string => value !== null)
    : [];

  return (
    <div className="space-y-5 text-sm">
      <StatusStrip tone="warning" icon={AlertTriangle} title={t('payments.proposals.aiWarning')} />
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t('payments.proposals.providerReference')}</dt>
          <dd className="break-all">{statement.reference}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('payments.proposals.providerTransactionId')}</dt>
          <dd className="break-all">{statement.providerTransactionId}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('payments.proposals.providerAmount')}</dt>
          <dd>
            {formatCurrency(statement.amount, statement.currencyCode)}{' '}
            <span className="font-mono text-xs text-secondary-500">{statement.currencyCode}</span>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t('payments.proposals.settledAt')}</dt>
          <dd>{formatDateTime(statement.settledAt)}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('payments.proposals.fee')}</dt>
          <dd>
            {formatCurrency(statement.fee, statement.currencyCode)}{' '}
            <span className="font-mono text-xs text-secondary-500">{statement.currencyCode}</span>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t('payments.proposals.confidence')}</dt>
          <dd>{t(`payments.proposals.confidenceValue.${proposal.evidence.confidence}`)}</dd>
        </div>
      </dl>
      <div>
        <p className="font-semibold">{t('payments.proposals.aiExplanation')}</p>
        <p className="mt-1 text-secondary-600">{explanation}</p>
      </div>
      <div>
        <h4 className="font-semibold">{t('payments.proposals.candidates')}</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="pv-table">
            <thead>
              <tr>
                <th>{t('payments.proposals.posReference')}</th>
                <th>{t('payments.proposals.providerTransactionId')}</th>
                <th className="num">{t('payments.proposals.posAmount')}</th>
                <th>{t('payments.proposals.candidateStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(candidate => (
                <tr key={candidate.outboxId}>
                  <td className="break-all">
                    {candidate.reference}
                    {candidate.outboxId === recommendedOutboxId && (
                      <Badge variant="warning">{t('payments.proposals.recommended')}</Badge>
                    )}
                  </td>
                  <td className="break-all">{candidate.providerTransactionId ?? '—'}</td>
                  <td className="num">
                    {formatCurrency(candidate.amount, candidate.currencyCode)}{' '}
                    {candidate.currencyCode}
                  </td>
                  <td>{t(`payments.status.${candidate.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 className="font-semibold">{t('payments.proposals.discrepancies')}</h4>
        {discrepancies.length === 0 ? (
          <p>{t('payments.proposals.noDiscrepancies')}</p>
        ) : (
          <ul className="list-disc pl-5">
            {discrepancies.map(discrepancy => (
              <li key={discrepancy}>{t(`payments.proposals.discrepancy.${discrepancy}`)}</li>
            ))}
          </ul>
        )}
      </div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={providerChecked}
          onChange={event => onProviderCheckedChange(event.target.checked)}
          disabled={!isAdmin}
          data-testid="payment-proposal-provider-checked"
        />
        <span>{t('payments.proposals.providerCheck')}</span>
      </label>
      {!isAdmin && <p className="text-secondary-500">{t('payments.proposals.noPermission')}</p>}
    </div>
  );
}
