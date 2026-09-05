import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Pill, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import {
  selectedEvidenceCoversRequirement,
  type PharmacyCheckoutRequirement,
} from './pharmacyCheckout';

interface SalePharmacyEvidenceSectionProps {
  enabled: boolean;
  isLoading: boolean;
  isUnavailable: boolean;
  countryCode: string | null;
  businessDate: string | null;
  customerId: string;
  customerValid: boolean | null;
  canApproveEvidence: boolean;
  requirements: PharmacyCheckoutRequirement[];
  selectedEvidenceIds: string[];
  ready: boolean;
  onToggleEvidence: (id: string, selected: boolean) => void;
  onEvidenceApproved: (id: string) => void;
  onRefetch: () => Promise<void>;
}

interface PendingEvidenceIdentity {
  id: string;
  customerId: string;
  productId: string;
  approvalStatus: 'pending' | 'approved';
}

function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function SalePharmacyEvidenceSection(props: SalePharmacyEvidenceSectionProps) {
  // Remount the sensitive workflow synchronously when its subject changes.
  // Cart coverage and eligible rows are deliberately excluded: they change as
  // each prescription is approved, while other products may still have a
  // pending approval action that must remain reachable.
  const workflowScopeKey = JSON.stringify([
    props.enabled,
    props.customerId,
    props.customerValid,
    props.countryCode,
    props.businessDate,
  ]);
  return <StatefulSalePharmacyEvidenceSection key={workflowScopeKey} {...props} />;
}

function StatefulSalePharmacyEvidenceSection({
  enabled,
  isLoading,
  isUnavailable,
  countryCode,
  businessDate,
  customerId,
  customerValid,
  canApproveEvidence,
  requirements,
  selectedEvidenceIds,
  ready,
  onToggleEvidence,
  onEvidenceApproved,
  onRefetch,
}: SalePharmacyEvidenceSectionProps) {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const toast = useToast();
  const regulated = requirements.filter(requirement => requirement.evidenceRequired);
  const [recordProductId, setRecordProductId] = useState('');
  const [reference, setReference] = useState('');
  const [prescriberName, setPrescriberName] = useState('');
  const [prescriberCredential, setPrescriberCredential] = useState('');
  const [buyerDocument, setBuyerDocument] = useState('');
  const [authorizedQuantity, setAuthorizedQuantity] = useState(1);
  const [validFrom, setValidFrom] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingEvidence, setPendingEvidence] = useState<PendingEvidenceIdentity[]>([]);
  const adoptedEvidenceIds = useRef(new Set<string>());

  const selectedSet = useMemo(() => new Set(selectedEvidenceIds), [selectedEvidenceIds]);
  const actionableRegulated = regulated.filter(
    requirement =>
      requirement.blockedErrorCode === null &&
      !selectedEvidenceCoversRequirement(requirement, selectedEvidenceIds)
  );
  const effectiveRecordProductId = actionableRegulated.some(
    requirement => requirement.productId === recordProductId
  )
    ? recordProductId
    : (actionableRegulated[0]?.productId ?? '');
  const selectedRequirement =
    actionableRegulated.find(requirement => requirement.productId === effectiveRecordProductId) ??
    null;
  const selectedPendingEvidence = selectedRequirement
    ? (pendingEvidence.find(
        evidence =>
          evidence.customerId === customerId &&
          evidence.productId === selectedRequirement.productId &&
          !selectedRequirement.eligibleEvidence.some(eligible => eligible.id === evidence.id)
      ) ?? null)
    : null;
  const draftMatchesSelection = recordProductId === effectiveRecordProductId;
  const effectiveReference = draftMatchesSelection ? reference : '';
  const effectivePrescriberName = draftMatchesSelection ? prescriberName : '';
  const effectivePrescriberCredential = draftMatchesSelection ? prescriberCredential : '';
  const effectiveBuyerDocument = draftMatchesSelection ? buyerDocument : '';
  const effectiveNotes = draftMatchesSelection ? notes : '';
  const effectiveRequestedQuantity = selectedRequirement?.requestedQuantity ?? 1;
  const effectiveAuthorizedQuantity = draftMatchesSelection
    ? authorizedQuantity
    : effectiveRequestedQuantity;
  const effectiveValidFrom = (draftMatchesSelection ? validFrom : '') || businessDate || '';
  const effectiveExpiresAt =
    (draftMatchesSelection ? expiresAt : '') ||
    (businessDate ? addCalendarDays(businessDate, 30) : '');
  const evidenceDatesValid =
    effectiveValidFrom.length > 0 &&
    effectiveExpiresAt.length > 0 &&
    effectiveExpiresAt >= effectiveValidFrom;
  const authorizedQuantityValid =
    Number.isFinite(effectiveAuthorizedQuantity) &&
    effectiveAuthorizedQuantity > 0 &&
    effectiveAuthorizedQuantity <= 1_000_000_000;

  const clearSensitiveFields = useCallback(() => {
    setReference('');
    setPrescriberName('');
    setPrescriberCredential('');
    setBuyerDocument('');
    setAuthorizedQuantity(1);
    setValidFrom('');
    setExpiresAt('');
    setNotes('');
  }, []);
  const recordEvidence = useCriticalMutation('pharmacy.recordEvidence', {
    onSuccess: (result, variables) => {
      // Bind the pending approval action to the variables that actually
      // committed. The operator may switch the product while the network
      // response is in flight, so reading selectedRequirement here could
      // attach one prescription to a different medicine in the UI.
      setPendingEvidence(current => [
        ...current.filter(
          evidence =>
            evidence.customerId !== variables.customerId ||
            evidence.productId !== variables.productId
        ),
        {
          id: result.id,
          customerId: variables.customerId,
          productId: variables.productId,
          approvalStatus: 'pending',
        },
      ]);
      // The committed row is now represented by its opaque id. Do not retain
      // prescription PII in renderer state while a second employee approves.
      setRecordProductId(variables.productId);
      clearSensitiveFields();
      toast.success({ title: t('pharmacy:checkout.recorded') });
    },
  });
  const approveEvidence = useCriticalMutation('pharmacy.approveEvidence', {
    onSuccess: async result => {
      // Approval already committed, but selection must wait until an
      // authoritative checkout projection actually exposes the id. Keeping an
      // opaque approved marker makes a failed refetch recoverable without
      // retaining or re-entering prescription PII.
      setPendingEvidence(current =>
        current.map(evidence =>
          evidence.id === result.id ? { ...evidence, approvalStatus: 'approved' } : evidence
        )
      );
      clearSensitiveFields();
      await onRefetch();
    },
  });
  const resetRecordEvidence = recordEvidence.reset;
  const resetApproveEvidence = approveEvidence.reset;

  // Prop changes can move the effective form before a local event runs. Render
  // an empty derived draft immediately, then materialize it only from the next
  // operator event. This avoids both a stale PII frame and effect-driven state
  // synchronization.
  const prepareEffectiveDraft = () => {
    if (recordProductId === effectiveRecordProductId) return;
    setRecordProductId(effectiveRecordProductId);
    clearSensitiveFields();
    setAuthorizedQuantity(effectiveRequestedQuantity);
    resetApproveEvidence();
    resetRecordEvidence();
  };

  // A manager may approve the just-recorded evidence in another session. A
  // successful refetch then turns that exact row into eligible evidence; adopt
  // every matching row once and remove the now-stale local approval actions.
  useEffect(() => {
    const externallyApproved = pendingEvidence.filter(pending => {
      if (pending.customerId !== customerId) return false;
      return requirements
        .find(requirement => requirement.productId === pending.productId)
        ?.eligibleEvidence.some(evidence => evidence.id === pending.id);
    });
    if (externallyApproved.length === 0) return;
    const newlyApproved = externallyApproved.filter(
      evidence => !adoptedEvidenceIds.current.has(evidence.id)
    );
    if (newlyApproved.length === 0) return;
    for (const evidence of newlyApproved) adoptedEvidenceIds.current.add(evidence.id);
    resetApproveEvidence();
    resetRecordEvidence();
    for (const evidence of newlyApproved) onEvidenceApproved(evidence.id);
    toast.success({ title: t('pharmacy:checkout.approvedAndSelected') });
  }, [
    customerId,
    onEvidenceApproved,
    pendingEvidence,
    resetApproveEvidence,
    resetRecordEvidence,
    requirements,
    t,
    toast,
  ]);

  const mutationError = recordEvidence.error ?? approveEvidence.error;
  const errorMessage = mutationError
    ? translateServerError(mutationError, t, t('errors:server.unknown'))
    : null;

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-primary-200 bg-primary-50 p-4" role="status">
        <p className="text-sm font-medium text-primary-900">{t('pharmacy:checkout.checking')}</p>
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className="rounded-xl border border-danger-200 bg-danger-50 p-4" role="alert">
        <p className="text-sm text-danger-800">{t('pharmacy:checkout.unavailable')}</p>
        <button type="button" className="btn-secondary mt-3" onClick={() => void onRefetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('pharmacy:checkout.retry')}
        </button>
      </div>
    );
  }

  if (requirements.length === 0) return null;

  return (
    <section
      className="rounded-2xl border border-primary-200 bg-primary-50/60 p-4"
      aria-labelledby="sale-pharmacy-heading"
      data-testid="sale-pharmacy-evidence"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary-800 shadow-sm">
            <Pill className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="sale-pharmacy-heading" className="font-semibold text-primary-950">
              {t('pharmacy:checkout.title')}
            </h3>
            <p className="mt-0.5 text-xs text-primary-800">
              {t('pharmacy:checkout.policyContext', {
                country: countryCode,
                date: businessDate,
              })}
            </p>
          </div>
        </div>
        <button type="button" className="btn-secondary shrink-0" onClick={() => void onRefetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('pharmacy:checkout.refresh')}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {requirements.map(requirement => {
          const requirementCovered = selectedEvidenceCoversRequirement(
            requirement,
            selectedEvidenceIds
          );
          return (
            <article
              key={requirement.productId}
              className="rounded-xl border border-primary-100 bg-white p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-secondary-950">
                  {requirement.productName}
                </p>
                <span className="rounded-full bg-surface-2 px-2 py-1 text-xs font-medium uppercase text-secondary-700">
                  {t(`pharmacy:checkout.classifications.${requirement.classification}`)}
                </span>
              </div>
              {requirement.blockedErrorCode ? (
                <div className="mt-2 flex gap-2 text-sm text-danger-800" role="alert">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>{t(`pharmacyErrors:server.${requirement.blockedErrorCode}`)}</p>
                </div>
              ) : requirement.evidenceRequired ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-secondary-600">
                    {t('pharmacy:checkout.quantityRequired', {
                      quantity: requirement.requestedQuantity,
                    })}
                  </p>
                  {requirement.eligibleEvidence.length === 0 ? (
                    <p className="text-sm font-medium text-warning-800">
                      {customerId && customerValid
                        ? t('pharmacy:checkout.noEvidence')
                        : t('pharmacy:checkout.customerRequired')}
                    </p>
                  ) : (
                    <>
                      {requirement.eligibleEvidence.map(evidence => {
                        const selected = selectedSet.has(evidence.id);
                        return (
                          <label
                            key={evidence.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                          >
                            <span>
                              {t('pharmacy:checkout.evidenceLabel', {
                                id: evidence.id.slice(-8),
                                quantity: evidence.remainingQuantity,
                              })}
                            </span>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!selected && requirementCovered}
                              onChange={event =>
                                onToggleEvidence(evidence.id, event.target.checked)
                              }
                              aria-label={t('pharmacy:checkout.selectEvidence', {
                                product: requirement.productName,
                                id: evidence.id.slice(-8),
                              })}
                            />
                          </label>
                        );
                      })}
                      {requirementCovered ? (
                        <p className="text-xs text-success-800" role="status">
                          {t('pharmacy:checkout.selectionCovered')}
                        </p>
                      ) : null}
                    </>
                  )}
                  {(requirement.reapprovalEvidence ?? []).length > 0 ? (
                    <div className="mt-3 space-y-2 rounded-lg border border-warning-200 bg-warning-50 p-3">
                      <p className="text-xs font-medium text-warning-950">
                        {t('pharmacy:checkout.reapprovalRequired')}
                      </p>
                      {(requirement.reapprovalEvidence ?? []).map(evidence => (
                        <div
                          key={evidence.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <p className="text-xs text-warning-900">
                            {t('pharmacy:checkout.reapprovalReason', {
                              id: evidence.id.slice(-8),
                              reason: t(`pharmacyErrors:server.${evidence.reasonCode}`),
                            })}
                          </p>
                          {canApproveEvidence ? (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={approveEvidence.isPending}
                              onClick={() => {
                                setPendingEvidence(current => [
                                  ...current.filter(
                                    item =>
                                      item.customerId !== customerId ||
                                      item.productId !== requirement.productId
                                  ),
                                  {
                                    id: evidence.id,
                                    customerId,
                                    productId: requirement.productId,
                                    approvalStatus: 'pending',
                                  },
                                ]);
                                setRecordProductId(requirement.productId);
                                approveEvidence.mutate({ id: evidence.id });
                              }}
                            >
                              {approveEvidence.isPending
                                ? t('pharmacy:checkout.reapproving')
                                : t('pharmacy:checkout.reapprove')}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 flex items-center gap-2 text-sm text-success-800">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {t('pharmacy:checkout.otcReady')}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {actionableRegulated.length > 0 && customerId && customerValid && selectedRequirement ? (
        <details className="mt-4 rounded-xl border border-primary-100 bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary-900">
            {t('pharmacy:checkout.recordNew')}
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="pv-field sm:col-span-2">
              <span className="label">{t('pharmacy:checkout.product')}</span>
              <select
                className="pv-input"
                value={selectedRequirement.productId}
                disabled={recordEvidence.isPending || approveEvidence.isPending}
                onChange={event => {
                  clearSensitiveFields();
                  resetApproveEvidence();
                  resetRecordEvidence();
                  setRecordProductId(event.target.value);
                  const next = actionableRegulated.find(
                    item => item.productId === event.target.value
                  );
                  if (next) setAuthorizedQuantity(next.requestedQuantity);
                }}
              >
                {actionableRegulated.map(requirement => (
                  <option key={requirement.productId} value={requirement.productId}>
                    {requirement.productName}
                  </option>
                ))}
              </select>
            </label>
            <label className="pv-field sm:col-span-2">
              <span className="label">{t('pharmacy:checkout.reference')}</span>
              <input
                className="pv-input"
                value={effectiveReference}
                maxLength={200}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={event => {
                  prepareEffectiveDraft();
                  setReference(event.target.value);
                }}
              />
            </label>
            <label className="pv-field">
              <span className="label">{t('pharmacy:checkout.prescriberName')}</span>
              <input
                className="pv-input"
                value={effectivePrescriberName}
                maxLength={160}
                autoComplete="off"
                spellCheck={false}
                onChange={event => {
                  prepareEffectiveDraft();
                  setPrescriberName(event.target.value);
                }}
              />
            </label>
            <label className="pv-field">
              <span className="label">{t('pharmacy:checkout.prescriberCredential')}</span>
              <input
                className="pv-input"
                value={effectivePrescriberCredential}
                maxLength={160}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={event => {
                  prepareEffectiveDraft();
                  setPrescriberCredential(event.target.value);
                }}
              />
            </label>
            <label className="pv-field">
              <span className="label">{t('pharmacy:checkout.buyerDocument')}</span>
              <input
                className="pv-input"
                value={effectiveBuyerDocument}
                maxLength={120}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={event => {
                  prepareEffectiveDraft();
                  setBuyerDocument(event.target.value);
                }}
              />
            </label>
            <label className="pv-field">
              <span className="label">{t('pharmacy:checkout.authorizedQuantity')}</span>
              <input
                type="number"
                min="0.001"
                max="1000000000"
                step="any"
                className="pv-input"
                value={effectiveAuthorizedQuantity}
                onChange={event => {
                  prepareEffectiveDraft();
                  setAuthorizedQuantity(Number(event.target.value));
                }}
              />
            </label>
            <label className="pv-field">
              <span className="label">{t('pharmacy:checkout.validFrom')}</span>
              <input
                type="date"
                className="pv-input"
                value={effectiveValidFrom}
                onChange={event => {
                  prepareEffectiveDraft();
                  setValidFrom(event.target.value);
                }}
              />
            </label>
            <label className="pv-field">
              <span className="label">{t('pharmacy:checkout.expiresAt')}</span>
              <input
                type="date"
                className="pv-input"
                value={effectiveExpiresAt}
                min={effectiveValidFrom || undefined}
                onChange={event => {
                  prepareEffectiveDraft();
                  setExpiresAt(event.target.value);
                }}
              />
            </label>
            <label className="pv-field sm:col-span-2">
              <span className="label">{t('pharmacy:checkout.notes')}</span>
              <textarea
                className="pv-input area"
                value={effectiveNotes}
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
                onChange={event => {
                  prepareEffectiveDraft();
                  setNotes(event.target.value);
                }}
              />
            </label>
          </div>

          {!evidenceDatesValid ? (
            <p className="mt-3 text-sm text-danger-700" role="alert">
              {t('pharmacy:checkout.invalidDates')}
            </p>
          ) : null}

          {selectedPendingEvidence ? (
            selectedPendingEvidence.approvalStatus === 'approved' ? (
              <p className="mt-4 text-sm font-medium text-primary-900" role="status">
                {t('pharmacy:checkout.approvalRecordedAwaitingRefresh')}
              </p>
            ) : canApproveEvidence ? (
              <button
                type="button"
                className="btn-primary mt-4"
                disabled={approveEvidence.isPending}
                onClick={() => approveEvidence.mutate({ id: selectedPendingEvidence.id })}
              >
                {approveEvidence.isPending
                  ? t('pharmacy:checkout.approving')
                  : t('pharmacy:checkout.approveAndSelect')}
              </button>
            ) : (
              <p className="mt-4 text-sm font-medium text-warning-900" role="status">
                {t('pharmacy:checkout.awaitingProfessionalApproval')}
              </p>
            )
          ) : (
            <button
              type="button"
              className="btn-primary mt-4"
              disabled={
                recordEvidence.isPending ||
                approveEvidence.isPending ||
                effectiveReference.trim().length < 2 ||
                effectivePrescriberName.trim().length < 2 ||
                effectivePrescriberCredential.trim().length < 2 ||
                !authorizedQuantityValid ||
                !evidenceDatesValid
              }
              onClick={() =>
                recordEvidence.mutate({
                  productId: selectedRequirement.productId,
                  customerId,
                  reference: effectiveReference,
                  prescriberName: effectivePrescriberName || null,
                  prescriberCredential: effectivePrescriberCredential || null,
                  buyerDocument: effectiveBuyerDocument || null,
                  notes: effectiveNotes || null,
                  authorizedQuantity: effectiveAuthorizedQuantity,
                  validFrom: effectiveValidFrom,
                  expiresAt: effectiveExpiresAt,
                })
              }
            >
              {recordEvidence.isPending
                ? t('pharmacy:checkout.recording')
                : t('pharmacy:checkout.record')}
            </button>
          )}
          {errorMessage ? (
            <p className="mt-3 text-sm text-danger-700" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </details>
      ) : null}

      {!ready ? (
        <p className="mt-4 text-sm font-medium text-warning-900" role="status">
          {t('pharmacy:checkout.notReady')}
        </p>
      ) : (
        <p
          className="mt-4 flex items-center gap-2 text-sm font-medium text-success-800"
          role="status"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {t('pharmacy:checkout.ready')}
        </p>
      )}
    </section>
  );
}
