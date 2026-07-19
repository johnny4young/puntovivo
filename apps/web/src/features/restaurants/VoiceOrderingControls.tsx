import { Mic, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const TABLE_LABEL_MAX = 80;

interface RestaurantTableOption {
  id: string;
  name: string;
}

interface VoiceOrderingControlsProps {
  tableLabel: string;
  tableCatalog: RestaurantTableOption[];
  useCatalogDropdown: boolean;
  micDisabled: boolean;
  micDisabledReason: string | null;
  onTableLabelChange: (value: string) => void;
  onOpenVoice: () => void;
  onOpenSearch: () => void;
}

/** ENG-178 — Presentational table and item-entry controls for voice ordering. */
export function VoiceOrderingControls({
  tableLabel,
  tableCatalog,
  useCatalogDropdown,
  micDisabled,
  micDisabledReason,
  onTableLabelChange,
  onOpenVoice,
  onOpenSearch,
}: VoiceOrderingControlsProps): React.ReactElement {
  const { t } = useTranslation(['restaurants', 'voice']);

  return (
    <section className="space-y-4">
      <div className="card p-4">
        <label
          htmlFor="voice-ordering-table-label"
          className="text-xs font-medium uppercase tracking-wide text-secondary-500"
        >
          {t('restaurants:tableLabel.label')}
        </label>
        {useCatalogDropdown ? (
          <select
            id="voice-ordering-table-label"
            data-testid="voice-ordering-table-select"
            className="input mt-1 w-full text-lg"
            aria-required="true"
            value={tableLabel}
            onChange={event => onTableLabelChange(event.target.value)}
          >
            <option value="">
              {t('restaurants:tables.dropdown.selectPlaceholder')}
            </option>
            {tableCatalog.map(row => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="voice-ordering-table-label"
            data-testid="voice-ordering-table-input"
            className="input mt-1 w-full text-lg"
            type="text"
            maxLength={TABLE_LABEL_MAX}
            placeholder={t('restaurants:tableLabel.placeholder')}
            aria-required="true"
            value={tableLabel}
            onChange={event => onTableLabelChange(event.target.value)}
          />
        )}
        {tableLabel.trim().length === 0 && (
          <p className="mt-1 text-xs text-warning-700">
            {t('restaurants:tableLabel.required')}
          </p>
        )}
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
          {t('restaurants:surface.subheading')}
        </p>
        <button
          type="button"
          className="btn-primary w-full text-base"
          onClick={onOpenVoice}
          disabled={micDisabled}
          data-testid="voice-ordering-mic-cta"
          aria-label={t('restaurants:actions.voiceCTA')}
        >
          <Mic className="h-5 w-5" />
          {t('restaurants:actions.voiceCTA')}
        </button>
        {micDisabled && (
          <p
            className="text-xs text-warning-700"
            data-testid="voice-ordering-mic-disabled-hint"
          >
            {micDisabledReason}
          </p>
        )}
        <button
          type="button"
          className="btn-outline w-full"
          onClick={onOpenSearch}
          data-testid="voice-ordering-manual-add"
        >
          <Search className="h-4 w-4" />
          {t('restaurants:actions.manualAdd')}
        </button>
      </div>
    </section>
  );
}
