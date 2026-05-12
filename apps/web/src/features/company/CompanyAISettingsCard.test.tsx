/**
 * ENG-040c slice 2 — CompanyAISettingsCard tests.
 *
 * Focus: the Test transcription affordance. The save / Test
 * connection paths shipped earlier (ENG-030) — this suite locks
 * the new pieces:
 *   (a) Button renders when admin + AI on + provider configured +
 *       capable.
 *   (b) Button is disabled with the unavailable hint when the active
 *       provider lacks `transcriptionAvailable`.
 *   (c) Start → Stop fires `trpc.ai.transcribeAudio.mutate` with the
 *       base64 + MIME payload.
 *   (d) Mutation success renders the transcript panel inline.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const transcribeMutate = vi.fn();
const transcribeMutationState: {
  isPending: boolean;
  onSuccessRef: ((data: unknown) => void) | null;
} = { isPending: false, onSuccessRef: null };

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Recorder mock — exposes a hand-controlled start / stop so the test
// drives the click sequence without touching the real MediaRecorder.
const recorderState: {
  recording: boolean;
  supported: boolean;
  error: { kind: string; message: string } | null;
  startMock: ReturnType<typeof vi.fn>;
  stopMock: ReturnType<typeof vi.fn>;
  resetMock: ReturnType<typeof vi.fn>;
} = {
  recording: false,
  supported: true,
  error: null,
  startMock: vi.fn(async () => {
    recorderState.recording = true;
  }),
  stopMock: vi.fn(async () => new Blob(['fake-audio'], { type: 'audio/webm' })),
  resetMock: vi.fn(),
};

vi.mock('./useVoiceRecorder', async () => {
  // Keep the constants live so the card's SERVER_MIME_LIST narrow
  // still resolves the same array.
  const actual = await vi.importActual<typeof import('./useVoiceRecorder')>(
    './useVoiceRecorder'
  );
  return {
    ...actual,
    useVoiceRecorder: () => ({
      recording: recorderState.recording,
      supported: recorderState.supported,
      error: recorderState.error,
      recordedMimeType: 'audio/webm',
      start: recorderState.startMock,
      stop: recorderState.stopMock,
      reset: recorderState.resetMock,
    }),
  };
});

vi.mock('./blobToBase64', () => ({
  blobToBase64: async () => ({
    base64: 'ZmFrZS1hdWRpbw==',
    mimeType: 'audio/webm',
  }),
}));

type SettingsPayload = {
  enabled: boolean;
  monthlyBudgetUsd: number;
  providerId: 'anthropic' | 'openai' | 'ollama';
  modelId: string | null;
  defaultModelId: string;
  effectiveModelId: string;
  providerConfigured: boolean;
  currentMonthSpendUsd: number;
  availableProviders: Array<{ id: string; defaultModelId: string; isImplemented: boolean }>;
  transcriptionAvailable: boolean;
};

const defaultSettings: SettingsPayload = {
  enabled: true,
  monthlyBudgetUsd: 100,
  providerId: 'openai',
  modelId: null,
  defaultModelId: 'gpt-4.1-mini',
  effectiveModelId: 'gpt-4.1-mini',
  providerConfigured: true,
  currentMonthSpendUsd: 0,
  availableProviders: [
    { id: 'anthropic', defaultModelId: 'claude-haiku-4-5', isImplemented: true },
    { id: 'openai', defaultModelId: 'gpt-4.1-mini', isImplemented: true },
    { id: 'ollama', defaultModelId: 'llama3.2', isImplemented: true },
  ],
  transcriptionAvailable: true,
};

let mockSettingsState: SettingsPayload = { ...defaultSettings };

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      ai: {
        settings: { get: { invalidate: vi.fn(async () => undefined) } },
      },
    }),
    ai: {
      settings: {
        get: {
          useQuery: () => ({ data: mockSettingsState, isLoading: false, error: null }),
        },
        update: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
      completeTest: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      transcribeAudio: {
        useMutation: (options: {
          onSuccess?: (data: unknown) => void;
          onError?: (err: unknown) => void;
        }) => {
          transcribeMutationState.onSuccessRef = options.onSuccess ?? null;
          return {
            mutate: (input: unknown) => {
              transcribeMutate(input);
            },
            isPending: transcribeMutationState.isPending,
          };
        },
      },
    },
  },
}));

import { CompanyAISettingsCard } from './CompanyAISettingsCard';

describe('CompanyAISettingsCard (ENG-040c slice 2 — Test transcription)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSettingsState = { ...defaultSettings };
    recorderState.recording = false;
    recorderState.supported = true;
    recorderState.error = null;
    recorderState.startMock = vi.fn(async () => {
      recorderState.recording = true;
    });
    recorderState.stopMock = vi.fn(async () => new Blob(['fake-audio'], { type: 'audio/webm' }));
    recorderState.resetMock = vi.fn();
    transcribeMutationState.isPending = false;
    transcribeMutationState.onSuccessRef = null;
    await i18n.changeLanguage('en');
  });

  it('renders the Test transcription button when admin + AI enabled + provider configured + capable', () => {
    render(<CompanyAISettingsCard />);
    const button = screen.getByTestId('ai-transcribe-button');
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    // No gating hint when everything aligns.
    expect(screen.queryByTestId('ai-transcribe-hint')).not.toBeInTheDocument();
  });

  it('disables the button + renders the unavailable hint when transcriptionAvailable is false', () => {
    mockSettingsState = { ...defaultSettings, transcriptionAvailable: false };
    render(<CompanyAISettingsCard />);
    const button = screen.getByTestId('ai-transcribe-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      "Your provider doesn't support transcription. Switch to OpenAI in this card."
    );
    expect(screen.getByTestId('ai-transcribe-hint')).toHaveTextContent(
      /Your provider doesn't support transcription/
    );
  });

  it('disables the button + explains when AI is off', () => {
    mockSettingsState = { ...defaultSettings, enabled: false };
    render(<CompanyAISettingsCard />);
    const button = screen.getByTestId('ai-transcribe-button');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('ai-transcribe-hint')).toHaveTextContent(
      /Turn on AI features/
    );
  });

  it('start → stop fires ai.transcribeAudio.mutate with the expected base64 + MIME payload', async () => {
    const { rerender } = render(<CompanyAISettingsCard />);

    // First click: start recording.
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-transcribe-button'));
    });
    expect(recorderState.startMock).toHaveBeenCalledTimes(1);

    // Force the next render to reflect the recording state — the
    // recorder mock flipped its internal flag inside startMock. The
    // live region is always mounted; we check that its text content
    // now carries the "Recording…" hint rather than the empty idle
    // string.
    rerender(<CompanyAISettingsCard />);
    expect(screen.getByTestId('ai-transcribe-countdown')).toHaveTextContent(
      /Recording|Grabando/
    );

    // Second click: stop recording → blobToBase64 → mutate.
    await act(async () => {
      fireEvent.click(screen.getByTestId('ai-transcribe-button'));
    });
    await waitFor(() => {
      expect(transcribeMutate).toHaveBeenCalledTimes(1);
    });
    expect(transcribeMutate).toHaveBeenCalledWith({
      audioBase64: 'ZmFrZS1hdWRpbw==',
      mimeType: 'audio/webm',
    });
  });

  it('renders the transcript panel inline on mutation success', async () => {
    render(<CompanyAISettingsCard />);
    // Sanity: panel hidden before success.
    expect(screen.queryByTestId('ai-transcript-panel')).not.toBeInTheDocument();

    // Drive the mutation's onSuccess callback that the card wired in.
    expect(transcribeMutationState.onSuccessRef).toBeInstanceOf(Function);
    await act(async () => {
      transcribeMutationState.onSuccessRef?.({
        transcript: 'agrega dos cocas y un pan',
        language: 'es',
        audioDurationSeconds: 4.2,
        costUsd: 0.000_42,
        durationMs: 800,
        provider: 'openai',
        model: 'whisper-1',
        auditLogId: 'audit-1',
      });
    });
    expect(screen.getByTestId('ai-transcript-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ai-transcript-text')).toHaveTextContent(
      'agrega dos cocas y un pan'
    );
    expect(screen.getByTestId('ai-transcript-language')).toHaveTextContent('es');
    expect(screen.getByTestId('ai-transcript-duration')).toHaveTextContent('4.2s');
  });
});
