// slice 2 — the transcription result panel, extracted from
// CompanyAISettingsCard.tsx ( slice 34). Presentational: the card gates
// the render on a non-null result and passes the clear handler.

import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { TranscriptionResult } from './useAiTranscriptionTest';

interface AiTranscriptResultProps {
  result: TranscriptionResult;
  onClear: () => void;
}

export function AiTranscriptResult({ result, onClear }: AiTranscriptResultProps) {
  const { t } = useTranslation('aiSettings');
  return (
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
          {result.transcript}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs text-fg3 sm:grid-cols-3">
        <div>
          <dt className="font-medium text-fg3">{t('aiSettings:card.transcriptLanguageLabel')}</dt>
          <dd className="mt-0.5 text-fg2" data-testid="ai-transcript-language">
            {result.language ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-fg3">{t('aiSettings:card.transcriptDurationLabel')}</dt>
          <dd className="mt-0.5 text-fg2" data-testid="ai-transcript-duration">
            {t('aiSettings:card.transcriptDurationValue', {
              seconds: result.audioDurationSeconds.toFixed(1),
            })}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-fg3">{t('aiSettings:card.transcriptCostLabel')}</dt>
          <dd className="mt-0.5 text-fg2" data-testid="ai-transcript-cost">
            {formatCurrency(result.costUsd, 'USD')}
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="text-xs font-medium text-primary-700 hover:underline"
        onClick={onClear}
        data-testid="ai-transcript-clear"
      >
        {t('aiSettings:card.transcribeClearAction')}
      </button>
    </div>
  );
}
