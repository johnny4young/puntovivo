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
import { Mic, MicOff, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

import { blobToBase64 } from './blobToBase64';
import {
  MAX_TEST_RECORDING_MS,
  VOICE_RECORDER_MIME_TYPES,
  useVoiceRecorder,
  type VoiceRecorderMimeType,
} from './useVoiceRecorder';

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

  const settingsQuery = trpc.ai.settings.get.useQuery();

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

  const updateMutation = trpc.ai.settings.update.useMutation({
    onSuccess: async () => {
      await utils.ai.settings.get.invalidate();
      toast.success({ title: t('aiSettings:toast.saveSuccessTitle') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'aiSettings:toast.saveErrorTitle',
    }),
  });

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
  const overBudget = budgetNumber > 0 && spentUsd >= budgetNumber;

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
    <section className="card p-6 space-y-5" data-testid="company-ai-card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Sparkles className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
            {t('aiSettings:card.kicker')}
          </p>
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('aiSettings:card.title')}
          </h2>
          <p className="text-sm text-secondary-500">
            {t('aiSettings:card.description')}
          </p>
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled}
          onChange={event => setEnabledLocal(event.target.checked)}
          data-testid="ai-enabled-toggle"
        />
        <span>
          <span className="font-medium text-secondary-800">
            {t('aiSettings:card.enableLabel')}
          </span>
          <span className="block text-xs text-secondary-500">
            {t('aiSettings:card.enableHint')}
          </span>
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('aiSettings:card.providerLabel')}
        </span>
        <select
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
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
        <span className="mt-1 block text-xs text-secondary-500">
          {t('aiSettings:card.providerHint')}
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('aiSettings:card.modelLabel')}
        </span>
        <input
          type="text"
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
          value={modelOverride}
          onChange={event => setModelLocal(event.target.value)}
          placeholder={t('aiSettings:card.modelPlaceholder', {
            defaultModelId,
          })}
          data-testid="ai-model-input"
        />
        <span className="mt-1 block text-xs text-secondary-500">
          {t('aiSettings:card.modelHint')}
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium text-secondary-800">
          {t('aiSettings:card.budgetLabel')}
        </span>
        <input
          type="number"
          min="0"
          step="1"
          className="mt-1 block w-full rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
          value={budgetInput ?? ''}
          onChange={event => setBudgetLocal(event.target.value)}
          data-testid="ai-budget-input"
        />
        <span className="mt-1 block text-xs text-secondary-500">
          {t('aiSettings:card.budgetHint')}
        </span>
      </label>

      <div
        className={
          overBudget
            ? 'surface-panel-muted text-sm text-danger-700'
            : 'surface-panel-muted text-sm text-secondary-600'
        }
        data-testid="ai-spend-display"
      >
        <span className="font-medium">
          {t('aiSettings:card.spentLabel')}:
        </span>{' '}
        {formatCurrency(spentUsd, 'USD')}{' '}
        {t('aiSettings:card.spentSuffix', {
          budget: formatCurrency(budgetNumber, 'USD'),
        })}
      </div>

      <p className="text-xs">
        <span
          className={
            data?.providerConfigured
              ? 'text-success-700'
              : 'text-secondary-500'
          }
          data-testid="ai-provider-badge"
        >
          {data?.providerConfigured
            ? t('aiSettings:card.providerOk')
            : t('aiSettings:card.providerMissing')}
        </span>
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
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
          className="btn-outline"
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
          className="btn-outline flex items-center gap-2"
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
        className="text-xs text-secondary-600"
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
          className="surface-panel-muted space-y-3 text-sm text-secondary-700"
          data-testid="ai-transcript-panel"
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
              {t('aiSettings:card.transcriptResultLabel')}
            </p>
            <p
              className="mt-1 whitespace-pre-wrap break-words text-secondary-900"
              data-testid="ai-transcript-text"
            >
              {transcriptionResult.transcript}
            </p>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-xs text-secondary-600 sm:grid-cols-3">
            <div>
              <dt className="font-medium text-secondary-500">
                {t('aiSettings:card.transcriptLanguageLabel')}
              </dt>
              <dd
                className="mt-0.5 text-secondary-800"
                data-testid="ai-transcript-language"
              >
                {transcriptionResult.language ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-secondary-500">
                {t('aiSettings:card.transcriptDurationLabel')}
              </dt>
              <dd
                className="mt-0.5 text-secondary-800"
                data-testid="ai-transcript-duration"
              >
                {t('aiSettings:card.transcriptDurationValue', {
                  seconds: transcriptionResult.audioDurationSeconds.toFixed(1),
                })}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-secondary-500">
                {t('aiSettings:card.transcriptCostLabel')}
              </dt>
              <dd
                className="mt-0.5 text-secondary-800"
                data-testid="ai-transcript-cost"
              >
                {formatCurrency(transcriptionResult.costUsd, 'USD')}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="text-xs text-primary-700 hover:underline"
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
