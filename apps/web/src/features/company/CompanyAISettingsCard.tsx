/**
 * Admin-only card for AI settings.
 *
 * Sits inside `CompanyPage`'s admin grid. Reads `ai.settings.get`,
 * writes via `ai.settings.update`, and exposes a "Test connection"
 * button that runs `ai.completeTest` end-to-end so the operator can
 * validate the environment and provider round-trip directly.
 *
 * The provider selector renders every registered provider and its
 * default model. Registry entries are all callable implementations.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Mic, MicOff, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency } from '@/lib/utils';

import { useAiSettings } from '@/features/ai-shared';

import { useAiTranscriptionTest } from './useAiTranscriptionTest';
import { AiQuotaSection } from './AiQuotaSection';
import { AiTranscriptResult } from './AiTranscriptResult';

export function CompanyAISettingsCard() {
  const { t } = useTranslation(['aiSettings', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const { settingsQuery, updateMutation } = useAiSettings({
    t,
    saveErrorTitleKey: 'aiSettings:toast.saveErrorTitle',
  });

  // Controlled local-edit overlay. `null` means "fall back to the
  // server value"; user interaction sets the local override. We avoid
  // a useEffect-on-data-arrival hydration pattern (the lint rule
  // `react-hooks/no-cascading-renders` flags it) — instead the render
  // path reads `localValue ?? serverValue` everywhere.
  const [enabledLocal, setEnabledLocal] = useState<boolean | null>(null);
  const [providerLocal, setProviderLocal] = useState<'anthropic' | 'openai' | 'ollama' | null>(
    null
  );
  const [modelLocal, setModelLocal] = useState<string | null>(null);
  const [budgetLocal, setBudgetLocal] = useState<string | null>(null);

  const enabled = enabledLocal ?? settingsQuery.data?.enabled ?? false;
  const providerId = providerLocal ?? settingsQuery.data?.providerId ?? 'anthropic';
  const modelOverride = modelLocal ?? settingsQuery.data?.modelId ?? '';
  const budgetInput = budgetLocal ?? String(settingsQuery.data?.monthlyBudgetUsd ?? 0);

  const testMutation = trpc.ai.completeTest.useMutation({
    onSuccess: result => {
      toast.success({
        title: t('aiSettings:toast.testSuccessTitle'),
        description: t('aiSettings:toast.testSuccessDescription', {
          model: result.model,
          durationMs: result.durationMs,
          cost: formatCurrency(result.costUsd, 'USD'),
        }),
      });
      void utils.ai.settings.get.invalidate();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'aiSettings:toast.testErrorTitle',
    }),
  });

  const data = settingsQuery.data;

  // The voice-transcription test feature (recorder +
  // transcribeAudio mutation + countdown + gating) lives in its own hook;
  // the card keeps the transcribe button / hint / countdown JSX below.
  const transcription = useAiTranscriptionTest({
    enabled,
    providerConfigured: data?.providerConfigured ?? false,
    transcriptionAvailable: data?.transcriptionAvailable ?? false,
  });

  const availableProviders = useMemo(
    () => data?.availableProviders ?? [],
    [data?.availableProviders]
  );
  const selectedProviderEntry = useMemo(
    () => availableProviders.find(p => p.id === providerId),
    [availableProviders, providerId]
  );
  const defaultModelId =
    selectedProviderEntry?.defaultModelId ?? data?.defaultModelId ?? data?.effectiveModelId ?? '';

  const budgetNumber = (() => {
    const parsed = Number(budgetInput);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  })();
  const spentUsd = data?.currentMonthSpendUsd ?? 0;
  const hasBudget = budgetNumber > 0;
  const overBudget = hasBudget && spentUsd >= budgetNumber;

  // The legacy spend line composed
  // `formatCurrency(spent) + "de " + formatCurrency(budget)`, which
  // rendered the broken "US$0.35 de US$0.00" whenever no budget was
  // set (budget 0 means "disabled", not "a zero ceiling"). The §15
  // redesign replaces it with a tonal meter: spent / limit reading,
  // a surface-3 track + primary fill bar, and an explicit
  // "sin límite" reading when the ceiling is off. The fill ratio is
  // only meaningful when a positive limit exists.
  const budgetRatio = hasBudget ? spentUsd / budgetNumber : 0;
  const budgetWidth = hasBudget ? Math.min(100, Math.round(budgetRatio * 100)) : 0;

  const saveDisabled = updateMutation.isPending || settingsQuery.isLoading;
  const testDisabled = testMutation.isPending || !data?.providerConfigured || !enabled;

  function handleSave(): void {
    if (saveDisabled) return;
    const trimmedModel = modelOverride.trim();
    updateMutation.mutate({
      enabled,
      monthlyBudgetUsd: budgetNumber,
      providerId,
      modelId: trimmedModel.length > 0 ? trimmedModel : null,
    });
  }

  return (
    <section className="card p-6 space-y-6" data-testid="company-ai-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="pv-kicker">{t('aiSettings:card.kicker')}</p>
            <h2 className="pv-title text-xl">{t('aiSettings:card.title')}</h2>
            <p className="max-w-prose text-sm text-fg3">{t('aiSettings:card.description')}</p>
          </div>
        </div>

        {/* master toggle promoted from a raw checkbox to the
            system switch recipe (the §15 fix: "interruptor, no checkbox").
            The button carries the toggle semantics so the visual switch
            stays a presentational span. */}
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className="text-sm font-medium text-fg2">
            {enabled
              ? t('aiSettings:card.enabledStateLabel')
              : t('aiSettings:card.disabledStateLabel')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={t('aiSettings:card.enableLabel')}
            onClick={() => setEnabledLocal(!enabled)}
            data-testid="ai-enabled-toggle"
          >
            <span className={cn('pv-switch', enabled && 'on')} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="text-xs text-fg3">{t('aiSettings:card.enableHint')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="pv-field">
          <label htmlFor="ai-provider-select" className="label">
            {t('aiSettings:card.providerLabel')}
          </label>
          <span className="pv-input">
            <select
              id="ai-provider-select"
              className="flex-1 cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit outline-none"
              value={providerId}
              onChange={event =>
                setProviderLocal(event.target.value as 'anthropic' | 'openai' | 'ollama')
              }
              data-testid="ai-provider-select"
            >
              {availableProviders.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.id}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" />
          </span>
          <p className="help">{t('aiSettings:card.providerHint')}</p>
        </div>

        <div className="pv-field">
          <label htmlFor="ai-model-input" className="label">
            {t('aiSettings:card.modelLabel')}
          </label>
          <span className="pv-input">
            <input
              id="ai-model-input"
              type="text"
              className="w-full border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-fg4"
              value={modelOverride}
              onChange={event => setModelLocal(event.target.value)}
              placeholder={t('aiSettings:card.modelPlaceholder', {
                defaultModelId,
              })}
              data-testid="ai-model-input"
            />
          </span>
          <p className="help">{t('aiSettings:card.modelHint')}</p>
        </div>
      </div>

      <div className="pv-field">
        <label htmlFor="ai-budget-input" className="label">
          {t('aiSettings:card.budgetLabel')}
        </label>
        <span className="pv-input">
          <input
            id="ai-budget-input"
            type="number"
            min="0"
            step="1"
            className="w-full border-0 bg-transparent p-0 text-inherit outline-none"
            value={budgetInput ?? ''}
            onChange={event => setBudgetLocal(event.target.value)}
            data-testid="ai-budget-input"
          />
        </span>
        <p className="help">{t('aiSettings:card.budgetHint')}</p>
      </div>

      {/* tonal budget meter (replaces the broken
          "US$0.35 de US$0.00" line). Track is surface-3, fill is
          primary, flips to danger once spend reaches the limit. When
          no limit is set the reading says "sin límite" instead of
          dividing by a zero ceiling. */}
      <div className="space-y-2" data-testid="ai-spend-display">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-fg2">
            {t('aiSettings:card.budgetMeterLabel')}
          </span>
          <span
            className={cn(
              'font-mono text-xs tabular-nums',
              overBudget ? 'text-danger-700' : 'text-fg2'
            )}
            data-testid="ai-spend-reading"
          >
            {hasBudget
              ? `${formatCurrency(spentUsd, 'USD')} / ${formatCurrency(budgetNumber, 'USD')}`
              : t('aiSettings:card.budgetMeterNoLimit', {
                  spent: formatCurrency(spentUsd, 'USD'),
                })}
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={budgetWidth}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('aiSettings:card.budgetMeterLabel')}
          data-testid="ai-spend-bar"
          data-tone={overBudget ? 'danger' : 'primary'}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              overBudget ? 'bg-danger-600' : 'bg-primary'
            )}
            style={{ width: `${budgetWidth}%` }}
          />
        </div>
        <p className="text-xs text-fg3">{t('aiSettings:card.budgetMeterHint')}</p>
      </div>

      {/* per-site monthly AI quotas. Hidden when the master
        AI toggle is off (cuota is irrelevant if AI is disabled).
        Each row renders a progress bar that flips warning at >=80%
        and danger at >=100%. The reset date footer tells the cashier
        when the counter rolls over. The data shape is server-side
        per-site; the panel always reflects the active site.
      */}
      {enabled && data?.quotas?.copilot && data.quotas.invoiceOcr && (
        <AiQuotaSection quotas={data.quotas} />
      )}

      <span
        className={cn('pv-badge', data?.providerConfigured ? 'success' : 'neutral')}
        data-testid="ai-provider-badge"
      >
        <span className="dot" aria-hidden="true" />
        {data?.providerConfigured
          ? t('aiSettings:card.providerOk')
          : t('aiSettings:card.providerMissing')}
      </span>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="pv-btn primary"
          onClick={handleSave}
          disabled={saveDisabled}
          data-testid="ai-save-button"
        >
          {updateMutation.isPending
            ? t('aiSettings:card.savingAction')
            : t('aiSettings:card.saveAction')}
        </button>
        <button
          type="button"
          className="pv-btn outline"
          onClick={() => testMutation.mutate()}
          disabled={testDisabled}
          data-testid="ai-test-button"
        >
          {testMutation.isPending
            ? t('aiSettings:card.testingAction')
            : t('aiSettings:card.testAction')}
        </button>
        <button
          type="button"
          className="pv-btn outline"
          onClick={() => {
            void transcription.onTranscribeToggle();
          }}
          // `transcribeDisabled` includes the in-flight pending guard,
          // but the recording branch needs the button enabled to allow
          // the cashier to stop. Disable unconditionally while the
          // mutation is pending so a double-stop click doesn't fire a
          // second `transcribeAudio` call against the same blob.
          disabled={
            (transcription.transcribeDisabled && !transcription.recording) ||
            transcription.isTranscribing
          }
          aria-pressed={transcription.recording}
          title={transcription.transcriptionGateHint ?? undefined}
          data-testid="ai-transcribe-button"
        >
          {transcription.recording ? (
            <MicOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="h-4 w-4" aria-hidden="true" />
          )}
          <span>
            {transcription.isTranscribing
              ? t('aiSettings:card.transcribingAction')
              : transcription.recording
                ? t('aiSettings:card.transcribeStopAction')
                : t('aiSettings:card.transcribeAction')}
          </span>
        </button>
      </div>

      {transcription.transcriptionGateHint !== null && !transcription.recording && (
        <p className="text-xs text-warning-700" data-testid="ai-transcribe-hint">
          {transcription.transcriptionGateHint}
        </p>
      )}

      {/* Mount the live region unconditionally — ARIA only announces
        changes inside a region that was already attached. When the
        region toggles in/out of the DOM, screen readers miss the
        initial recording-started transition. */}
      <p
        aria-live="polite"
        aria-atomic="true"
        className="text-xs text-fg3"
        data-testid="ai-transcribe-countdown"
      >
        {transcription.recording
          ? t('aiSettings:card.transcribeRecordingHint', {
              seconds: transcription.recordingSeconds,
            })
          : ''}
      </p>

      {transcription.transcriptionResult !== null && (
        <AiTranscriptResult
          result={transcription.transcriptionResult}
          onClear={transcription.onClearTranscript}
        />
      )}
    </section>
  );
}
