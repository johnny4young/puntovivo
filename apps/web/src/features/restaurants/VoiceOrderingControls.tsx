import { Mic, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const TABLE_LABEL_MAX = 80;

/** Minimal active-table projection used by the table selector. */
interface RestaurantTableOption {
  id: string;
  name: string;
  seatCount?: number | null;
}

/** Controlled table, party and item-entry state for the ordering surface. */
interface VoiceOrderingControlsProps {
  /** Phones pick a table from a grid; the till keeps the compact dropdown. */
  tablePicker: 'grid' | 'dropdown';
  canCreateTables: boolean;
  dineInActive: boolean;
  tableLabel: string;
  tableCatalog: RestaurantTableOption[];
  useCatalogDropdown: boolean;
  tableCatalogLoading: boolean;
  tableCatalogError: boolean;
  guestCount: number;
  guestCountMaximum: number;
  guestCountLocked: boolean;
  checkLabel: string;
  interactionDisabled: boolean;
  micDisabled: boolean;
  micDisabledReason: string | null;
  onTableLabelChange: (value: string) => void;
  onGuestCountChange: (value: number) => void;
  onCheckLabelChange: (value: string) => void;
  onOpenVoice: () => void;
  onOpenSearch: () => void;
}

/** Presentational table and item-entry controls for voice ordering. */
export function VoiceOrderingControls({
  tablePicker,
  canCreateTables,
  dineInActive,
  tableLabel,
  tableCatalog,
  useCatalogDropdown,
  tableCatalogLoading,
  tableCatalogError,
  guestCount,
  guestCountMaximum,
  guestCountLocked,
  checkLabel,
  interactionDisabled,
  micDisabled,
  micDisabledReason,
  onTableLabelChange,
  onGuestCountChange,
  onCheckLabelChange,
  onOpenVoice,
  onOpenSearch,
}: VoiceOrderingControlsProps): React.ReactElement {
  const { t } = useTranslation(['restaurants', 'voice']);

  return (
    <section className="space-y-4">
      <div className="card p-4">
        <label
          id={tablePicker === 'grid' ? 'voice-ordering-table-label' : undefined}
          htmlFor={tablePicker === 'grid' ? undefined : 'voice-ordering-table-label'}
          className="text-xs font-medium uppercase tracking-wide text-secondary-500"
        >
          {t('restaurants:tableLabel.label')}
        </label>
        {useCatalogDropdown && tablePicker === 'grid' ? (
          <div
            role="group"
            aria-labelledby="voice-ordering-table-label"
            className="mt-2 grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto"
            data-testid="voice-ordering-table-grid"
          >
            {tableCatalog.map(row => {
              const selected = row.name === tableLabel;
              return (
                <button
                  key={row.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={row.name}
                  disabled={interactionDisabled}
                  onClick={() => onTableLabelChange(row.name)}
                  className={`min-h-14 rounded-xl border px-3 py-2 text-left text-sm font-semibold ${
                    selected
                      ? 'border-primary-500 bg-primary-50 text-primary-900'
                      : 'border-line-strong bg-surface text-ink'
                  }`}
                >
                  {row.name}
                  {row.seatCount != null && (
                    <span className="block text-xs font-normal text-secondary-600">
                      {t('restaurants:floorMap.seatCount', { count: row.seatCount })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : useCatalogDropdown ? (
          <select
            id="voice-ordering-table-label"
            data-testid="voice-ordering-table-select"
            className="input mt-1 w-full text-lg"
            aria-required="true"
            value={tableLabel}
            disabled={interactionDisabled}
            onChange={event => onTableLabelChange(event.target.value)}
          >
            <option value="">{t('restaurants:tables.dropdown.selectPlaceholder')}</option>
            {tableCatalog.map(row => (
              <option key={row.id} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        ) : (
          <p
            className="mt-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-800"
            data-testid="voice-ordering-table-setup-hint"
          >
            {!dineInActive
              ? t('restaurants:tables.dropdown.moduleDisabledHint')
              : tableCatalogLoading
                ? t('restaurants:tables.loading')
                : tableCatalogError
                  ? t('restaurants:tables.error')
                  : t('restaurants:tables.dropdown.emptyOperationalHint')}
          </p>
        )}
        {!useCatalogDropdown &&
          dineInActive &&
          !tableCatalogLoading &&
          !tableCatalogError &&
          canCreateTables && (
            <Link
              to="/restaurants/tables"
              className="btn-primary mt-2 inline-flex min-h-11 items-center"
              data-testid="voice-ordering-create-tables"
            >
              {t('restaurants:tables.dropdown.createTables')}
            </Link>
          )}
        {tableLabel.trim().length === 0 && (
          <p className="mt-1 text-xs text-warning-700">{t('restaurants:tableLabel.required')}</p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-secondary-700">
            {t('restaurants:service.guestCount')}
            <input
              className="input mt-1 w-full"
              type="number"
              min={1}
              max={guestCountMaximum}
              step={1}
              value={guestCount}
              disabled={guestCountLocked || interactionDisabled}
              onChange={event => onGuestCountChange(Number(event.target.value))}
              data-testid="voice-ordering-guest-count"
            />
            {guestCountLocked && (
              <span className="mt-1 block font-normal text-secondary-500">
                {t('restaurants:service.guestCountLocked')}
              </span>
            )}
          </label>
          <label className="text-xs font-medium text-secondary-700">
            {t('restaurants:service.checkLabel')}
            <input
              className="input mt-1 w-full"
              type="text"
              maxLength={TABLE_LABEL_MAX}
              value={checkLabel}
              disabled={interactionDisabled}
              placeholder={t('restaurants:service.checkLabelPlaceholder')}
              onChange={event => onCheckLabelChange(event.target.value)}
              data-testid="voice-ordering-check-label"
            />
          </label>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
          {t('restaurants:surface.subheading')}
        </p>
        <button
          type="button"
          className="btn-primary w-full text-base"
          onClick={onOpenVoice}
          disabled={micDisabled || interactionDisabled}
          data-testid="voice-ordering-mic-cta"
          aria-label={t('restaurants:actions.voiceCTA')}
        >
          <Mic className="h-5 w-5" />
          {t('restaurants:actions.voiceCTA')}
        </button>
        {micDisabled && (
          <p className="text-xs text-warning-700" data-testid="voice-ordering-mic-disabled-hint">
            {micDisabledReason}
          </p>
        )}
        <button
          type="button"
          className="btn-outline w-full"
          onClick={onOpenSearch}
          disabled={interactionDisabled}
          data-testid="voice-ordering-manual-add"
        >
          <Search className="h-4 w-4" />
          {t('restaurants:actions.manualAdd')}
        </button>
      </div>
    </section>
  );
}
