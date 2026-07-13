import { useTranslation } from 'react-i18next';

export interface MatchedProduct {
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string | null;
  unitAbbreviation: string | null;
  unitEquivalence: number;
  unitPrice: number;
  taxRate: number;
  stock: number;
  sellByFraction: boolean;
  fractionStep: number | null;
  fractionMinimum: number | null;
  similarity: number;
}

export interface CartMatch {
  productHint: string;
  quantity: number | null;
  /** ENG-039a — free-form modifier captured by the parser. */
  note: string | null;
  product: MatchedProduct | null;
}

interface VoiceCartCommandReviewProps {
  transcript: string | null;
  matches: CartMatch[];
  unrecognizedReason: string | null;
  onApply: () => void;
  onRetry: () => void;
  onClose: () => void;
}

export function VoiceCartCommandReview({
  transcript,
  matches,
  unrecognizedReason,
  onApply,
  onRetry,
  onClose,
}: VoiceCartCommandReviewProps) {
  const { t } = useTranslation('voice');
  const matchedCount = matches.filter(match => match.product !== null).length;

  return (
    <div className="space-y-3" data-testid="voice-modal-review">
      {transcript !== null && (
        <div className="surface-panel-muted text-sm text-secondary-700">
          <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
            {t('transcriptLabel')}
          </p>
          <p
            className="mt-1 whitespace-pre-wrap break-words text-secondary-900"
            data-testid="voice-modal-transcript"
          >
            {transcript}
          </p>
        </div>
      )}

      {unrecognizedReason !== null && (
        <p className="text-sm text-warning-700" data-testid="voice-modal-unrecognized">
          {t('unrecognizedHint', { reason: unrecognizedReason })}
        </p>
      )}

      {matches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
            {t('matchedHeader')}
          </p>
          <ul className="space-y-1 text-sm">
            {matches.map((match, index) => (
              <li
                key={`${match.productHint}-${index}`}
                className={match.product ? 'text-secondary-900' : 'text-warning-700'}
                data-testid={match.product ? 'voice-modal-match' : 'voice-modal-unmatched'}
              >
                {match.product
                  ? t('matchedItem', {
                      quantity:
                        typeof match.quantity === 'number' && match.quantity > 0
                          ? match.quantity
                          : 1,
                      name: match.product.productName,
                    })
                  : t('unmatchedItem', { hint: match.productHint })}
                {match.note !== null && (
                  <span
                    className="ml-2 text-xs italic text-secondary-600"
                    data-testid="voice-modal-match-note"
                  >
                    {t('noteSuffix', { note: match.note })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={onApply}
          disabled={matchedCount === 0}
          data-testid="voice-modal-apply"
        >
          {t('applyCta')}
        </button>
        <button
          type="button"
          className="btn-outline"
          onClick={onRetry}
          data-testid="voice-modal-retry"
        >
          {t('tryAgainCta')}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          data-testid="voice-modal-close"
        >
          {t('closeCta')}
        </button>
      </div>
    </div>
  );
}
