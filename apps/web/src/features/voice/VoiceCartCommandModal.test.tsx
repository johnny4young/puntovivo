/**
 * slice 3 — VoiceCartCommandModal tests.
 *
 * Focus on the modal's contract with its parent:
 * (a) idle state renders the mic CTA + intro copy.
 * (b) recording state shows the live countdown + Stop label.
 * (c) review state renders matches + Aplicar button.
 * (d) Aplicar fires the parent `onApply` with the matched-only
 * payload (un-matched lines stay out).
 *
 * The recorder + tRPC mutations are mocked at the module level so
 * each test drives the modal's state machine directly.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
const transcribeMutateAsyncMock = vi.fn();
const parseMutateAsyncMock = vi.fn();

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
  stopMock: vi.fn(async () => new Blob(['fake'], { type: 'audio/webm' })),
  resetMock: vi.fn(),
};

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    warning: toastWarning,
    info: vi.fn(),
  }),
}));

vi.mock('@/features/voice/useVoiceRecorder', async () => {
  const actual = await vi.importActual<typeof import('@/features/voice/useVoiceRecorder')>(
    '@/features/voice/useVoiceRecorder'
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

vi.mock('@/features/voice/blobToBase64', () => ({
  blobToBase64: async () => ({
    base64: 'ZmFrZQ==',
    mimeType: 'audio/webm',
  }),
}));

vi.mock('@/lib/trpc', () => ({
  vanillaClient: {
    ai: {
      transcribeAudio: {
        mutate: (input: unknown, options: unknown) => transcribeMutateAsyncMock(input, options),
      },
      parseCartCommand: {
        mutate: (input: unknown, options: unknown) => parseMutateAsyncMock(input, options),
      },
    },
  },
}));

import { VoiceCartCommandModal } from './VoiceCartCommandModal';

beforeEach(async () => {
  vi.clearAllMocks();
  recorderState.recording = false;
  recorderState.supported = true;
  recorderState.error = null;
  recorderState.startMock = vi.fn(async () => {
    recorderState.recording = true;
  });
  recorderState.stopMock = vi.fn(async () => new Blob(['fake'], { type: 'audio/webm' }));
  recorderState.resetMock = vi.fn();
  await i18n.changeLanguage('en');
});

describe('VoiceCartCommandModal ( slice 3)', () => {
  it('focuses the dialog, traps Tab, closes on Escape, and restores the opener', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open voice';
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();

    try {
      const { rerender } = render(
        <VoiceCartCommandModal isOpen={true} onClose={onClose} onApply={vi.fn()} />
      );
      const close = screen.getByLabelText('Close');
      const record = screen.getByTestId('voice-modal-record');

      await waitFor(() => expect(close).toHaveFocus());
      expect(opener).toHaveAttribute('aria-hidden', 'true');
      expect(opener.inert).toBe(true);
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(record).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(close).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      rerender(<VoiceCartCommandModal isOpen={false} onClose={onClose} onApply={vi.fn()} />);
      await waitFor(() => expect(opener).toHaveFocus());
      expect(opener).not.toHaveAttribute('aria-hidden');
      expect(opener.inert).toBe(false);
    } finally {
      opener.remove();
    }
  });

  it('discards an in-flight transcription when the dialog closes', async () => {
    let resolveTranscription!: (value: { transcript: string }) => void;
    transcribeMutateAsyncMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveTranscription = resolve;
        })
    );
    recorderState.recording = true;
    const onClose = vi.fn();
    render(<VoiceCartCommandModal isOpen={true} onClose={onClose} onApply={vi.fn()} />);

    fireEvent.click(screen.getByTestId('voice-modal-record'));
    await waitFor(() => expect(transcribeMutateAsyncMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const transcribeOptions = transcribeMutateAsyncMock.mock.calls[0]?.[1] as {
      signal: AbortSignal;
    };
    expect(transcribeOptions.signal.aborted).toBe(true);

    await act(async () => {
      resolveTranscription({ transcript: 'discarded after close' });
    });
    expect(parseMutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('voice-modal-review')).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('aborts an in-flight parse without showing a late review or error', async () => {
    transcribeMutateAsyncMock.mockResolvedValue({ transcript: 'add bread' });
    let resolveParse!: (value: { mode: 'unrecognized'; reason: string }) => void;
    parseMutateAsyncMock.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveParse = resolve;
        })
    );
    recorderState.recording = true;
    const onClose = vi.fn();
    render(<VoiceCartCommandModal isOpen={true} onClose={onClose} onApply={vi.fn()} />);

    fireEvent.click(screen.getByTestId('voice-modal-record'));
    await waitFor(() => expect(parseMutateAsyncMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const parseOptions = parseMutateAsyncMock.mock.calls[0]?.[1] as { signal: AbortSignal };
    expect(parseOptions.signal.aborted).toBe(true);

    await act(async () => {
      resolveParse({ mode: 'unrecognized', reason: 'discarded' });
    });
    expect(screen.queryByTestId('voice-modal-review')).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('renders the idle state with the mic CTA + intro copy', () => {
    render(<VoiceCartCommandModal isOpen={true} onClose={vi.fn()} onApply={vi.fn()} />);
    expect(screen.getByTestId('voice-cart-modal')).toBeInTheDocument();
    const recordBtn = screen.getByTestId('voice-modal-record');
    expect(recordBtn).toHaveTextContent(/Start recording|Empezar a grabar/);
    expect(screen.getByTestId('voice-modal-countdown')).toHaveTextContent(
      /Tap to start|Toca para empezar/
    );
    expect(screen.queryByTestId('voice-modal-review')).not.toBeInTheDocument();
  });

  it('shows the live countdown + Stop CTA while recording', async () => {
    const { rerender } = render(
      <VoiceCartCommandModal isOpen={true} onClose={vi.fn()} onApply={vi.fn()} />
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('voice-modal-record'));
    });
    expect(recorderState.startMock).toHaveBeenCalledTimes(1);

    // Force the next render so the recorder's mutated flag flows
    // through the hook mock.
    rerender(<VoiceCartCommandModal isOpen={true} onClose={vi.fn()} onApply={vi.fn()} />);
    expect(screen.getByTestId('voice-modal-record')).toHaveTextContent(
      /Stop recording|Detener grabación/
    );
    expect(screen.getByTestId('voice-modal-countdown')).toHaveTextContent(/Recording|Grabando/);
  });

  it('stops an active recording on close without forwarding audio', async () => {
    const onClose = vi.fn();
    recorderState.recording = true;
    recorderState.stopMock = vi.fn(async () => new Blob(['discarded'], { type: 'audio/webm' }));

    render(<VoiceCartCommandModal isOpen={true} onClose={onClose} onApply={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Close|Cerrar/));
    });

    expect(recorderState.stopMock).toHaveBeenCalledTimes(1);
    expect(transcribeMutateAsyncMock).not.toHaveBeenCalled();
    expect(parseMutateAsyncMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders matches + Aplicar after a successful stop → transcribe → parse flow', async () => {
    transcribeMutateAsyncMock.mockResolvedValue({
      transcript: 'agrega dos cocas y un pan',
      language: 'es',
      audioDurationSeconds: 4,
      costUsd: 0.0001,
      durationMs: 500,
      provider: 'openai',
      model: 'whisper-1',
      auditLogId: 'a1',
    });
    parseMutateAsyncMock.mockResolvedValue({
      mode: 'parsed',
      transcript: 'agrega dos cocas y un pan',
      confidence: 'high',
      costUsd: 0.0002,
      durationMs: 600,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      auditLogId: 'a2',
      matches: [
        {
          productHint: 'coca cola',
          quantity: 2,
          product: {
            productId: 'p-cola',
            productName: 'Coca Cola 1.5L',
            productSku: 'CCL',
            unitId: 'u-1',
            unitName: 'Unidad',
            unitAbbreviation: 'UND',
            unitEquivalence: 1,
            unitPrice: 5000,
            taxRate: 0,
            stock: 24,
            sellByFraction: false,
            fractionStep: null,
            fractionMinimum: null,
            similarity: 0.95,
          },
        },
        {
          productHint: 'detergente',
          quantity: 1,
          product: null,
        },
      ],
    });

    // Start recording, then stop — the stop triggers the
    // transcribe → parse chain which lands the review state.
    recorderState.recording = true;
    render(<VoiceCartCommandModal isOpen={true} onClose={vi.fn()} onApply={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('voice-modal-record'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('voice-modal-review')).toBeInTheDocument();
    });
    expect(screen.getByTestId('voice-modal-transcript')).toHaveTextContent(
      'agrega dos cocas y un pan'
    );
    expect(screen.getAllByTestId('voice-modal-match')).toHaveLength(1);
    expect(screen.getAllByTestId('voice-modal-unmatched')).toHaveLength(1);
    const applyBtn = screen.getByTestId('voice-modal-apply');
    expect(applyBtn).not.toBeDisabled();
  });

  it('Aplicar fires onApply with the matched-only payload and closes the modal', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    transcribeMutateAsyncMock.mockResolvedValue({
      transcript: 'agrega una coca',
      language: 'es',
      audioDurationSeconds: 2,
      costUsd: 0,
      durationMs: 100,
      provider: 'openai',
      model: 'whisper-1',
      auditLogId: 'a1',
    });
    parseMutateAsyncMock.mockResolvedValue({
      mode: 'parsed',
      transcript: 'agrega una coca',
      confidence: 'high',
      costUsd: 0,
      durationMs: 100,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      auditLogId: 'a2',
      matches: [
        {
          productHint: 'coca',
          quantity: 2,
          product: {
            productId: 'p-cola',
            productName: 'Coca Cola',
            productSku: 'CCL',
            unitId: 'u-1',
            unitName: 'Unidad',
            unitAbbreviation: 'UND',
            unitEquivalence: 1,
            unitPrice: 5000,
            taxRate: 0,
            stock: 10,
            sellByFraction: false,
            fractionStep: null,
            fractionMinimum: null,
            similarity: 0.9,
          },
        },
        // Unmatched lines must NOT reach onApply.
        { productHint: 'detergente', quantity: 1, product: null },
      ],
    });

    recorderState.recording = true;
    render(<VoiceCartCommandModal isOpen={true} onClose={onClose} onApply={onApply} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('voice-modal-record'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('voice-modal-apply')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('voice-modal-apply'));
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0]![0] as Array<{
      selection: { product: { id: string } };
      quantity: number;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.selection.product.id).toBe('p-cola');
    expect(payload[0]?.quantity).toBe(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalled();
  });
});
