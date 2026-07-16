/**
 * ENG-040c slice 3 — shared voice cart command modal.
 *
 * Three-state UI:
 *   1. **idle**  → big mic button + "Habla ahora" prompt.
 *   2. **recording** → live aria-live countdown + Stop button.
 *   3. **reviewing** → transcript display + parsed match list +
 *      Aplicar al carrito / Volver a grabar / Cerrar.
 *
 * The component owns the audio flow but delegates cart hydration to
 * the parent via `onApply(items)`. Items carry the
 * `ProductSearchSelection` shape that POS ordering surfaces can pass
 * into their existing cart-merge helpers, plus a `quantity` field for
 * the parser-supplied count.
 *
 * @module features/voice/VoiceCartCommandModal
 */
import { useEffect, useState } from 'react';
import { Mic, MicOff, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { blobToBase64 } from '@/features/voice/blobToBase64';
import {
  VoiceCartCommandReview,
  type CartMatch,
  type MatchedProduct,
} from '@/features/voice/VoiceCartCommandReview';
import {
  MAX_TEST_RECORDING_MS,
  VOICE_RECORDER_MIME_TYPES,
  useVoiceRecorder,
  type VoiceRecorderMimeType,
} from '@/features/voice/useVoiceRecorder';
import type { ProductSearchSelection } from '@/types';

/** Server whitelist mirror — narrows the recorded MIME before the
 *  tRPC call. */
const SERVER_MIME_LIST: ReadonlyArray<VoiceRecorderMimeType> = VOICE_RECORDER_MIME_TYPES;

/**
 * Cart payload the parent applies via `mergeCartItem`. The
 * `selection` mirrors `ProductSearchSelection` (the existing
 * cart-merge entry point); `quantity` is the parser-supplied value
 * (defaults to 1 when the parser couldn't infer one).
 */
export interface VoiceCartItem {
  selection: ProductSearchSelection;
  quantity: number;
  /** Free-form modifier captured by the parser (e.g. "sin queso").
   *  Null when no modifier was spoken. Consumers route this to the
   *  cart row's `notes` field at hydration time. ENG-039a. */
  note: string | null;
}

export interface VoiceCartCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when the cashier accepts the parsed matches. Receives
   *  only matched items (product !== null); the parent translates
   *  each into `mergeCartItem` + `updateCartItem(quantity)`. */
  onApply: (items: VoiceCartItem[]) => void;
}

type ModalState = 'idle' | 'recording' | 'transcribing' | 'parsing' | 'reviewing';

/** Build a `ProductSearchSelection` from the server's matched
 *  product summary — same shape the OCR modal uses for purchase
 *  cart pre-fill. The Product fields not surfaced by the parser
 *  (pricing tiers, margins, sync state) default to 0 because
 *  `mergeCartItem` only reads name / sku / price / taxRate / stock /
 *  fraction-policy + the unit row; the rest are typed metadata
 *  that downstream consumers ignore at the cart-merge step. */
function buildSelection(match: MatchedProduct): ProductSearchSelection {
  return {
    product: {
      id: match.productId,
      tenantId: '',
      name: match.productName,
      sku: match.productSku,
      price: match.unitPrice,
      price2: 0,
      price3: 0,
      cost: 0,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: match.taxRate,
      initialCost: 0,
      stock: match.stock,
      minStock: 0,
      sellByFraction: match.sellByFraction,
      fractionStep: match.fractionStep ?? null,
      fractionMinimum: match.fractionMinimum ?? null,
      tracksLots: false,
      isActive: true,
      // ENG-177a — the parser summary does not carry the optimistic-version
      // token; 0 is inert here because this synthetic product is only routed
      // through `mergeCartItem`, never an update mutation.
      version: 0,
      createdAt: '',
      updatedAt: '',
    },
    unit: {
      // `id` is the unit-assignment row PK and is inert for cart-merge —
      // `buildCartItem` keys on `unit.unitId`, not `unit.id`. The
      // parser does not return the PK; pass empty so the shape
      // satisfies `ProductUnitAssignment`. Do NOT route this object
      // to any flow that mutates the unit-assignment row.
      id: '',
      unitId: match.unitId,
      unitName: match.unitName,
      unitAbbreviation: match.unitAbbreviation,
      equivalence: match.unitEquivalence,
      price: match.unitPrice,
      isBase: true,
    },
    price: match.unitPrice,
  };
}

export function VoiceCartCommandModal({
  isOpen,
  onClose,
  onApply,
}: VoiceCartCommandModalProps): React.ReactElement | null {
  const { t } = useTranslation(['voice', 'errors']);
  const toast = useToast();

  // Pipeline state. `phase` tracks the modal's lifecycle deterministically
  // (no cascading setState-in-effect); the recording branch is driven by
  // the recorder hook + the click handler, not by a derived effect.
  const [phase, setPhase] = useState<ModalState>('idle');
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [matches, setMatches] = useState<CartMatch[]>([]);
  const [unrecognizedReason, setUnrecognizedReason] = useState<string | null>(null);

  const transcribeMutation = trpc.ai.transcribeAudio.useMutation();
  const parseMutation = trpc.ai.parseCartCommand.useMutation();

  async function forwardBlob(blob: Blob): Promise<void> {
    try {
      const { base64, mimeType } = await blobToBase64(blob);
      const validatedMime = SERVER_MIME_LIST.find(m => m === mimeType);
      if (!validatedMime) {
        toast.error({
          title: t('voice:modalTitle'),
          description: t('voice:unsupportedHint'),
        });
        setPhase('idle');
        return;
      }
      setPhase('transcribing');
      const transcribed = await transcribeMutation.mutateAsync({
        audioBase64: base64,
        mimeType: validatedMime,
      });
      setTranscript(transcribed.transcript);
      setPhase('parsing');
      const parsed = await parseMutation.mutateAsync({
        transcript: transcribed.transcript,
      });
      if (parsed.mode === 'unrecognized') {
        setMatches([]);
        setUnrecognizedReason(parsed.reason);
      } else {
        setMatches(parsed.matches);
        setUnrecognizedReason(null);
      }
      setPhase('reviewing');
    } catch (err) {
      onErrorToast(toast, t, { titleKey: 'voice:modalTitle' })(err);
      setPhase('idle');
    }
  }

  const recorder = useVoiceRecorder({
    onAutoStop: blob => {
      setRecordingSeconds(0);
      void forwardBlob(blob);
    },
  });

  function resetModal(): void {
    setPhase('idle');
    setRecordingSeconds(0);
    setTranscript(null);
    setMatches([]);
    setUnrecognizedReason(null);
    recorder.reset();
  }

  async function handleClose(): Promise<void> {
    if (recorder.recording) {
      try {
        // Closing is a discard action. Stop the MediaRecorder so the
        // microphone is released, but do not forward the discarded blob
        // into the transcription/parser pipeline.
        await recorder.stop();
      } catch {
        // Best-effort cleanup; resetModal still clears local UI state.
      }
    }
    resetModal();
    onClose();
  }

  // Countdown ticker — runs only while recording. The phase
  // transition to 'recording' happens inline in `handleRecordToggle`
  // so this effect only manages the 1-second interval, not state
  // synchronization.
  useEffect(() => {
    if (!recorder.recording) return;
    const interval = window.setInterval(() => {
      setRecordingSeconds(prev => Math.min(prev + 1, MAX_TEST_RECORDING_MS / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [recorder.recording]);

  // The modal expects consumers to conditional-render (`{isOpen &&
  // <VoiceCartCommandModal ... />}`) so a second open mounts fresh
  // state. If a future consumer keeps the modal mounted across
  // `isOpen` toggles they should pass a `key` to force a remount.
  // Driving a state-reset effect from `isOpen` would trigger
  // `react-hooks/set-state-in-effect` cascades.
  async function handleRecordToggle(): Promise<void> {
    if (recorder.recording) {
      try {
        const blob = await recorder.stop();
        setRecordingSeconds(0);
        await forwardBlob(blob);
      } catch (err) {
        onErrorToast(toast, t, { titleKey: 'voice:modalTitle' })(err);
        setPhase('idle');
        setRecordingSeconds(0);
      }
      return;
    }
    // Starting a new recording resets prior review state.
    setPhase('recording');
    setRecordingSeconds(0);
    setTranscript(null);
    setMatches([]);
    setUnrecognizedReason(null);
    try {
      await recorder.start();
    } catch {
      // recorder.error carries the classified failure; the hint UI
      // renders it. Swallow the throw and fall back to idle.
      setPhase('idle');
    }
  }

  function handleApply(): void {
    const items: VoiceCartItem[] = matches
      .filter((m): m is CartMatch & { product: MatchedProduct } => m.product !== null)
      .map(m => ({
        selection: buildSelection(m.product),
        quantity: typeof m.quantity === 'number' && m.quantity > 0 ? m.quantity : 1,
        note: m.note,
      }));
    if (items.length === 0) {
      toast.warning({ title: t('voice:noMatches') });
      return;
    }
    onApply(items);
    toast.success({
      title: t('voice:applySuccess', { count: items.length }),
    });
    void handleClose();
  }

  if (!isOpen) return null;

  const errorHint =
    recorder.error?.kind === 'permission-denied'
      ? t('voice:permissionDeniedHint')
      : recorder.error?.kind === 'no-microphone'
        ? t('voice:noMicHint')
        : recorder.error?.kind === 'unsupported-browser' || !recorder.supported
          ? t('voice:unsupportedHint')
          : null;

  const recordDisabled =
    !recorder.supported || transcribeMutation.isPending || parseMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-modal-title"
      data-testid="voice-cart-modal"
    >
      <div className="card max-h-full w-full max-w-lg overflow-auto p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
              <Sparkles className="h-5 w-5 text-primary-700" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 id="voice-modal-title" className="text-base font-semibold text-secondary-900">
                {t('voice:modalTitle')}
              </h2>
              <p className="text-sm text-secondary-600">{t('voice:modalDescription')}</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost btn-icon h-8 w-8"
            aria-label={t('voice:closeCta')}
            onClick={() => {
              void handleClose();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {errorHint !== null && (
          <p className="text-xs text-warning-700" data-testid="voice-modal-hint">
            {errorHint}
          </p>
        )}

        <div className="space-y-3">
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            onClick={() => {
              void handleRecordToggle();
            }}
            disabled={recordDisabled && !recorder.recording}
            aria-pressed={recorder.recording}
            data-testid="voice-modal-record"
          >
            {recorder.recording ? (
              <MicOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Mic className="h-4 w-4" aria-hidden="true" />
            )}
            <span>{recorder.recording ? t('voice:stopCta') : t('voice:recordCta')}</span>
          </button>

          {/* Always-mounted live region so SR announces the state
            transition when recording starts. */}
          <p
            aria-live="polite"
            aria-atomic="true"
            className="text-xs text-secondary-600"
            data-testid="voice-modal-countdown"
          >
            {phase === 'idle' && !recorder.recording
              ? t('voice:promptIdle')
              : recorder.recording
                ? t('voice:recordingHint', { seconds: recordingSeconds })
                : phase === 'transcribing'
                  ? t('voice:transcribingHint')
                  : phase === 'parsing'
                    ? t('voice:parsingHint')
                    : ''}
          </p>
        </div>

        {phase === 'reviewing' && (
          <VoiceCartCommandReview
            transcript={transcript}
            matches={matches}
            unrecognizedReason={unrecognizedReason}
            onApply={handleApply}
            onRetry={() => {
              void handleRecordToggle();
            }}
            onClose={() => {
              void handleClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
