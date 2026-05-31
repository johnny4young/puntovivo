/**
 * ENG-030 — Admin-only card for AI settings.
 *
 * Sits inside `CompanyPage`'s admin grid. Reads `ai.settings.get`,
 * writes via `ai.settings.update`, and exposes a "Test connection"
 * button that runs `ai.completeTest` end-to-end so the operator can
 * validate the env-var + provider round-trip without waiting for
 * ENG-031 (co-pilot) or ENG-033 (semantic search) to land.
 *
 * Provider selector renders all registered providers. Implemented
 * providers are selectable; parked stubs keep a `(disponible con
 * ENG-NNN)` hint so the admin sees the roadmap.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Mic, MicOff, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency } from '@/lib/utils';

import { useAiSettings } from '@/features/ai-shared';

import { blobToBase64 } from '@/features/voice/blobToBase64';
import {
  MAX_TEST_RECORDING_MS,
  VOICE_RECORDER_MIME_TYPES,
  useVoiceRecorder,
  type VoiceRecorderMimeType,
} from '@/features/voice/useVoiceRecorder';

interface TranscriptionResult {
  transcript: string;
  language: string | null;
  audioDurationSeconds: number;
  costUsd: number;
}

/** Server whitelist mirror — used to validate the MediaRecorder's
 *  chosen MIME before forwarding to the mutation. The hook already
 *  picks from this list, but the explicit narrow keeps the tRPC
 *  enum input typed. */
const SERVER_MIME_LIST: ReadonlyArray<VoiceRecorderMimeType> = VOICE_RECORDER_MIME_TYPES;

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
  const [providerLocal, setProviderLocal] = useState<
    'anthropic' | 'openai' | 'ollama' | null
  >(null);
  const [modelLocal, setModelLocal] = useState<string | null>(null);
  const [budgetLocal, setBudgetLocal] = useState<string | null>(null);

  const enabled = enabledLocal ?? settingsQuery.data?.enabled ?? false;
  const providerId = providerLocal ?? settingsQuery.data?.providerId ?? 'anthropic';
  const modelOverride = modelLocal ?? settingsQuery.data?.modelId ?? '';
  const budgetInput =
    budgetLocal ?? String(settingsQuery.data?.monthlyBudgetUsd ?? 0);

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

  // ENG-040c slice 2 — transcription affordance state.
  const [transcriptionResult, setTranscriptionResult] =
    useState<TranscriptionResult | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);

  const transcribeMutation = trpc.ai.transcribeAudio.useMutation({
    onSuccess: result => {
      setTranscriptionResult({
        transcript: result.transcript,
        language: result.language,
        audioDurationSeconds: result.audioDurationSeconds,
        costUsd: result.costUsd,
      });
      toast.success({ title: t('aiSettings:toast.transcribeSuccessTitle') });
      void utils.ai.settings.get.invalidate();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'aiSettings:toast.transcribeErrorTitle',
    }),
  });

  const forwardBlob = useCallback(
    async (blob: Blob): Promise<void> => {
      try {
        const { base64, mimeType } = await blobToBase64(blob);
        const validatedMime = SERVER_MIME_LIST.find(m => m === mimeType);
        if (!validatedMime) {
          toast.error({
            title: t('aiSettings:toast.transcribeErrorTitle'),
            description: t('aiSettings:card.transcribeUnsupportedHint'),
          });
          return;
        }
        transcribeMutation.mutate({ audioBase64: base64, mimeType: validatedMime });
      } catch (err) {
        toast.error({
          title: t('aiSettings:toast.transcribeErrorTitle'),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [t, toast, transcribeMutation]
  );

  const handleAutoStop = useCallback(
    (blob: Blob) => {
      setRecordingSeconds(0);
      void forwardBlob(blob);
    },
    [forwardBlob]
  );

  const recorder = useVoiceRecorder({ onAutoStop: handleAutoStop });

  // Countdown ticker — runs only while recording, no cleanup state
  // reset because the click handlers reset `recordingSeconds` to 0
  // at the boundary transitions. Returning a no-op cleanup when
  // recording=false keeps the effect free of cascading set-state
  // calls.
  useEffect(() => {
    if (!recorder.recording) return;
    const interval = window.setInterval(() => {
      setRecordingSeconds(prev => Math.min(prev + 1, MAX_TEST_RECORDING_MS / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [recorder.recording]);

  function handleClearTranscript(): void {
    setTranscriptionResult(null);
    setRecordingSeconds(0);
    recorder.reset();
  }

  async function handleTranscribeToggle(): Promise<void> {
    if (recorder.recording) {
      try {
        const blob = await recorder.stop();
        setRecordingSeconds(0);
        await forwardBlob(blob);
      } catch (err) {
        setRecordingSeconds(0);
        toast.error({
          title: t('aiSettings:toast.transcribeErrorTitle'),
          description: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    setTranscriptionResult(null);
    setRecordingSeconds(0);
    try {
      await recorder.start();
    } catch {
      // `recorder.error` already carries the classified failure; the
      // hint UI renders it. Swallow the throw so the click handler
      // doesn't surface a generic toast on top of the hint.
    }
  }

  const data = settingsQuery.data;
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

  // ENG-039d4 FIX — the legacy spend line composed
  // `formatCurrency(spent) + "de " + formatCurrency(budget)`, which
  // rendered the broken "US$0.35 de US$0.00" whenever no budget was
  // set (budget 0 means "disabled", not "a zero ceiling"). The §15
  // redesign replaces it with a tonal meter: spent / limit reading,
  // a surface-3 track + primary fill bar, and an explicit
  // "sin límite" reading when the ceiling is off. The fill ratio is
  // only meaningful when a positive limit exists.
  const budgetRatio = hasBudget ? spentUsd / budgetNumber : 0;
  const budgetWidth = hasBudget ? Math.min(100, Math.round(budgetRatio * 100)) : 0;

  const saveDisabled =
    updateMutation.isPending ||
    settingsQuery.isLoading ||
    selectedProviderEntry?.isImplemented === false;
  const testDisabled =
    testMutation.isPending ||
    !data?.providerConfigured ||
    !enabled;

  // ENG-040c slice 2 — Test transcription gating. Disabled when AI is
  // off, provider isn't configured, the active provider lacks the
  // transcription capability, the browser lacks MediaRecorder
  // support, or a transcription is already in flight.
  const transcriptionAvailable = data?.transcriptionAvailable ?? false;
  const transcriptionGateHint = (() => {
    if (!recorder.supported) return t('aiSettings:card.transcribeUnsupportedHint');
    if (!enabled) return t('aiSettings:card.transcribeAiDisabledHint');
    if (!data?.providerConfigured) {
      return t('aiSettings:card.transcribeProviderMissingHint');
    }
    if (!transcriptionAvailable) return t('aiSettings:card.transcribeUnavailableHint');
    if (recorder.error?.kind === 'permission-denied') {
      return t('aiSettings:card.transcribePermissionHint');
    }
    if (recorder.error?.kind === 'no-microphone') {
      return t('aiSettings:card.transcribeNoMicHint');
    }
    return null;
  })();
  const transcribeDisabled =
    !recorder.supported ||
    !transcriptionAvailable ||
    !data?.providerConfigured ||
    !enabled ||
    transcribeMutation.isPending;

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
            <p className="max-w-prose text-sm text-fg3">
              {t('aiSettings:card.description')}
            </p>
          </div>
        </div>

        {/* ENG-039d4 — master toggle promoted from a raw checkbox to the
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
                <option
                  key={provider.id}
                  value={provider.id}
                  disabled={!provider.isImplemented}
                >
                  {provider.id}
                  {!provider.isImplemented
                    ? ` (${t('aiSettings:card.providerComingIn')} ${provider.availableInTicket})`
                    : ''}
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

      {/* ENG-039d4 — tonal budget meter (replaces the broken
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

      {/*
        ENG-102 — per-site monthly AI quotas. Hidden when the master
        AI toggle is off (cuota is irrelevant if AI is disabled).
        Each row renders a progress bar that flips warning at >=80%
        and danger at >=100%. The reset date footer tells the cashier
        when the counter rolls over. The data shape is server-side
        per-site; the panel always reflects the active site.
      */}
      {enabled && data?.quotas?.copilot && data.quotas.invoiceOcr && (
        <div
          className="space-y-3 rounded-2xl bg-surface-2 p-4"
          data-testid="ai-quota-section"
        >
          <p className="text-sm font-medium text-fg2">
            {t('aiSettings:card.quotas.title')}
          </p>
          {(['copilot', 'invoiceOcr'] as const).map(feature => {
            const q = data.quotas[feature];
            // Defensive guard — the outer condition already pins both
            // keys, but future server-side shape evolution might drop
            // a feature key. Skip the row instead of crashing the card.
            if (!q) return null;
            const ratio = q.limit > 0 ? q.used / q.limit : 0;
            const tone =
              ratio >= 1
                ? 'danger'
                : ratio >= 0.8
                  ? 'warning'
                  : 'success';
            const barColor =
              tone === 'danger'
                ? 'bg-danger-600'
                : tone === 'warning'
                  ? 'bg-warning-500'
                  : 'bg-success-600';
            const labelColor =
              tone === 'danger'
                ? 'text-danger-700'
                : tone === 'warning'
                  ? 'text-warning-700'
                  : 'text-fg2';
            const width = Math.min(100, Math.round(ratio * 100));
            const valueText = t('aiSettings:card.quotas.usedOfLimit', {
              used: q.used,
              limit: q.limit,
            });
            return (
              <div
                key={feature}
                className="space-y-1.5"
                data-testid={`ai-quota-${feature}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-fg2">
                    {t(`aiSettings:card.quotas.${feature}.label`)}
                  </span>
                  <span className={`font-mono text-xs tabular-nums ${labelColor}`}>
                    {valueText}
                  </span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
                  role="progressbar"
                  aria-valuenow={width}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  // aria-valuetext announces the raw count so screen
                  // readers say "100 / 800" instead of "12%". The
                  // progressbar's numeric meaning (percent) is not
                  // self-describing without the count.
                  aria-valuetext={valueText}
                  aria-label={t(`aiSettings:card.quotas.${feature}.label`)}
                  data-testid={`ai-quota-${feature}-bar`}
                  data-tone={tone}
                >
                  <div
                    className={`h-full rounded-full ${barColor}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
          {/*
            Reset date footer reads from the copilot quota because
            v1 has all features reset on the same calendar boundary
            (server-side `monthBounds` snapshot). If a future ticket
            decouples per-feature windows, move this into each row.
          */}
          <p className="text-xs text-fg3">
            {t('aiSettings:card.quotas.resetHint', {
              date: data.quotas.copilot.resetsAt
                ? data.quotas.copilot.resetsAt.slice(0, 10)
                : '—',
            })}
          </p>
        </div>
      )}

      <span
        className={cn(
          'pv-badge',
          data?.providerConfigured ? 'success' : 'neutral'
        )}
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
            void handleTranscribeToggle();
          }}
          // `transcribeDisabled` includes the in-flight pending guard,
          // but the recording branch needs the button enabled to allow
          // the cashier to stop. Disable unconditionally while the
          // mutation is pending so a double-stop click doesn't fire a
          // second `transcribeAudio` call against the same blob.
          disabled={
            (transcribeDisabled && !recorder.recording) ||
            transcribeMutation.isPending
          }
          aria-pressed={recorder.recording}
          title={transcriptionGateHint ?? undefined}
          data-testid="ai-transcribe-button"
        >
          {recorder.recording ? (
            <MicOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Mic className="h-4 w-4" aria-hidden="true" />
          )}
          <span>
            {transcribeMutation.isPending
              ? t('aiSettings:card.transcribingAction')
              : recorder.recording
                ? t('aiSettings:card.transcribeStopAction')
                : t('aiSettings:card.transcribeAction')}
          </span>
        </button>
      </div>

      {transcriptionGateHint !== null && !recorder.recording && (
        <p
          className="text-xs text-warning-700"
          data-testid="ai-transcribe-hint"
        >
          {transcriptionGateHint}
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
        {recorder.recording
          ? t('aiSettings:card.transcribeRecordingHint', {
              seconds: recordingSeconds,
            })
          : ''}
      </p>

      {transcriptionResult !== null && (
        <div
          className="space-y-3 rounded-2xl bg-surface-2 p-4 text-sm text-fg2"
          data-testid="ai-transcript-panel"
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-fg3">
              {t('aiSettings:card.transcriptResultLabel')}
            </p>
            <p
              className="mt-1 whitespace-pre-wrap break-words text-fg1"
              data-testid="ai-transcript-text"
            >
              {transcriptionResult.transcript}
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-xs text-fg3 sm:grid-cols-3">
            <div>
              <dt className="font-medium text-fg3">
                {t('aiSettings:card.transcriptLanguageLabel')}
              </dt>
              <dd
                className="mt-0.5 text-fg2"
                data-testid="ai-transcript-language"
              >
                {transcriptionResult.language ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-fg3">
                {t('aiSettings:card.transcriptDurationLabel')}
              </dt>
              <dd
                className="mt-0.5 text-fg2"
                data-testid="ai-transcript-duration"
              >
                {t('aiSettings:card.transcriptDurationValue', {
                  seconds: transcriptionResult.audioDurationSeconds.toFixed(1),
                })}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-fg3">
                {t('aiSettings:card.transcriptCostLabel')}
              </dt>
              <dd
                className="mt-0.5 text-fg2"
                data-testid="ai-transcript-cost"
              >
                {formatCurrency(transcriptionResult.costUsd, 'USD')}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="text-xs font-medium text-primary-700 hover:underline"
            onClick={handleClearTranscript}
            data-testid="ai-transcript-clear"
          >
            {t('aiSettings:card.transcribeClearAction')}
          </button>
        </div>
      )}
    </section>
  );
}
