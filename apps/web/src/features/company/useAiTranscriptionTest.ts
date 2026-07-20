// slice 2 — the voice-transcription test feature of the AI settings
// card, extracted from CompanyAISettingsCard.tsx ( slice 34). Owns the
// recorder + transcribeAudio mutation + the countdown + the gating; the card
// keeps the transcribe button / hint / countdown JSX and consumes this hook.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';

import { blobToBase64 } from '@/features/voice/blobToBase64';
import {
  MAX_TEST_RECORDING_MS,
  VOICE_RECORDER_MIME_TYPES,
  useVoiceRecorder,
  type VoiceRecorderMimeType,
} from '@/features/voice/useVoiceRecorder';

/** A completed transcription, surfaced in the result panel. */
export interface TranscriptionResult {
  transcript: string;
  language: string | null;
  audioDurationSeconds: number;
  costUsd: number;
}

/** Server whitelist mirror — used to validate the MediaRecorder's
 * chosen MIME before forwarding to the mutation. The hook already
 * picks from this list, but the explicit narrow keeps the tRPC
 * enum input typed. */
const SERVER_MIME_LIST: ReadonlyArray<VoiceRecorderMimeType> = VOICE_RECORDER_MIME_TYPES;

/**
 * Gating inputs from the AI-settings data: the master AI toggle, whether the
 * active provider has its API key configured, and whether that provider
 * exposes the transcription capability. The hook layers the browser's
 * MediaRecorder support + permission state on top to decide the final
 * disabled/hint outcome.
 */
interface UseAiTranscriptionTestArgs {
  enabled: boolean;
  providerConfigured: boolean;
  transcriptionAvailable: boolean;
}

/**
 * Drives the  "Test transcription" affordance: record -> stop ->
 * forward the blob (MIME-validated against the server whitelist) to
 * `ai.transcribeAudio`, surface the result, and gate the button with a
 * precedence-ordered hint. Returns exactly what the card's JSX renders.
 */
export function useAiTranscriptionTest({
  enabled,
  providerConfigured,
  transcriptionAvailable,
}: UseAiTranscriptionTestArgs) {
  const { t } = useTranslation(['aiSettings', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [transcriptionResult, setTranscriptionResult] = useState<TranscriptionResult | null>(null);
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

  // slice 2 — Test transcription gating. Disabled when AI is
  // off, provider isn't configured, the active provider lacks the
  // transcription capability, the browser lacks MediaRecorder
  // support, or a transcription is already in flight.
  const transcriptionGateHint = (() => {
    if (!recorder.supported) return t('aiSettings:card.transcribeUnsupportedHint');
    if (!enabled) return t('aiSettings:card.transcribeAiDisabledHint');
    if (!providerConfigured) {
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
    !providerConfigured ||
    !enabled ||
    transcribeMutation.isPending;

  return {
    transcriptionResult,
    recordingSeconds,
    recording: recorder.recording,
    isTranscribing: transcribeMutation.isPending,
    transcribeDisabled,
    transcriptionGateHint,
    onTranscribeToggle: handleTranscribeToggle,
    onClearTranscript: handleClearTranscript,
  };
}
