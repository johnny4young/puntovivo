import { useEffect, useEffectEvent, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clock3 } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { isTopmostModalDialog } from '@/components/feedback/useDialogA11y';
import { Button } from '@/components/ui/Button';
import { isEditableShortcutTarget } from '@/features/sales/salesKeyboard';
import {
  TillPriceCheckResult,
  TillProductSearch,
  type TillIncidentProduct,
} from '@/features/sales/incidents/TillIncidentProduct';
import { TillIncidentReportForm } from '@/features/sales/incidents/TillIncidentReportForm';
import {
  isTillIncidentAction,
  TILL_INCIDENT_GROUPS,
  tillIncidentTile,
  tillIncidentTileForKey,
  type TillIncidentAction,
  type TillIncidentTile,
  type TillIncidentTileId,
} from '@/features/sales/incidents/tillIncidentTiles';
import { useReportTillIncident } from '@/features/sales/incidents/useReportTillIncident';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDate } from '@/lib/utils';

/** Register flows a tile hands over to; a missing one leaves its tile unavailable. */
type TillIncidentActions = Partial<Record<TillIncidentAction, (() => void) | undefined>>;

interface TillIncidentSheetProps {
  onClose: () => void;
  /** Total of the open ticket; zero hides the line that says it stays intact. */
  ticketTotal: number;
  /** The site scanner's key gap: keys closer than this are a scan, not a hand. */
  scanGapMs?: number | undefined;
  /** Last product on the ticket, the default subject of a product incident. */
  product: TillIncidentProduct | null;
  actions: TillIncidentActions;
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
}

type View = 'menu' | Exclude<TillIncidentTileId, TillIncidentAction | 'callManager'>;

/** Novedad: every exception at the till behind one key, while the ticket stays put. */
export default function TillIncidentSheet({
  onClose,
  ticketTotal,
  scanGapMs = 30,
  product,
  actions,
  restoreFocusTo,
}: TillIncidentSheetProps) {
  const { t } = useTranslation('tillIncidents');
  const [view, setView] = useState<View>('menu');
  // The first tile, not the close button, takes focus: the letters mirror the grid.
  const firstTileRef = useRef<HTMLButtonElement>(null);
  const callManager = useReportTillIncident();

  const available = (id: TillIncidentTileId) =>
    isTillIncidentAction(id)
      ? actions[id] !== undefined
      : id !== 'callManager' || !callManager.isPending;

  const activate = (id: TillIncidentTileId) => {
    if (!available(id)) return;
    if (isTillIncidentAction(id)) {
      onClose();
      actions[id]?.();
    } else if (id === 'callManager') {
      callManager.send({ kind: 'call_manager' }, 'sent.call', onClose);
    } else {
      setView(id);
    }
  };

  // Letters pick a tile from anywhere in the menu; F9 closes from any step. A
  // scanner types faster than a hand, so its burst neither picks a tile nor
  // presses the focused control with its closing Enter.
  const activateFromKey = useEffectEvent(activate);
  const keyRun = useRef({ last: -Infinity, fast: 0 });
  const headerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      // A dialog opened over the sheet owns the keyboard.
      if (!isTopmostModalDialog(headerRef.current?.closest('[role="dialog"]') ?? null)) return;
      const now = performance.now();
      const isFast = now - keyRun.current.last < scanGapMs;
      keyRun.current = { last: now, fast: isFast ? keyRun.current.fast + 1 : 0 };
      if (isFast) clearTimeout(pending);
      if (event.key === 'Enter' && keyRun.current.fast >= 2) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.defaultPrevented) return;
      if (event.key === 'F9') {
        event.preventDefault();
        onClose();
        return;
      }
      if (isFast || view !== 'menu' || isEditableShortcutTarget(event.target)) return;
      const tile = tillIncidentTileForKey(event.key);
      if (!tile) return;
      event.preventDefault();
      pending = setTimeout(() => activateFromKey(tile.id), scanGapMs * 2);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      clearTimeout(pending);
    };
  }, [view, onClose, scanGapMs]);

  // Back from a step unmounts the focused control; the grid takes focus again.
  useEffect(() => {
    if (view === 'menu') firstTileRef.current?.focus();
  }, [view]);

  const stepTile = view === 'menu' ? null : tillIncidentTile(view);

  return (
    <Drawer
      isOpen
      onClose={onClose}
      ariaLabel={t('title')}
      showCloseButton={false}
      backdrop="clear"
      size="xl"
      restoreFocusTo={restoreFocusTo}
      initialFocusRef={firstTileRef}
      testId="till-incident-sheet"
      pinnedContent={
        <div className="till-incident-header" ref={headerRef}>
          {stepTile ? (
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setView('menu')}
                aria-label={t('back')}
                data-testid="till-incident-back"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </Button>
              <kbd className="pv-kbd till-incident-letter" aria-hidden="true">
                {stepTile.letter}
              </kbd>
              <h2 className="till-incident-title truncate">{t(`tiles.${stepTile.id}.label`)}</h2>
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="till-incident-title">{t('title')}</h2>
              {ticketTotal > 0 && (
                // On a phone the sheet covers the ticket, so the line would not be true.
                <p className="hidden text-sm text-fg2 sm:block" data-testid="till-incident-ticket">
                  {t('ticketIntact', { total: formatCurrency(ticketTotal) })}
                </p>
              )}
            </div>
          )}
          <Button
            variant="ghost"
            className="shrink-0"
            onClick={onClose}
            data-testid="till-incident-close"
          >
            {t('close')}
            <kbd className="pv-kbd hidden sm:inline-flex" aria-hidden="true">
              Esc
            </kbd>
          </Button>
        </div>
      }
    >
      {view === 'menu' && (
        <div className="space-y-4">
          {TILL_INCIDENT_GROUPS.map((group, groupIndex) => (
            <section key={group.id} aria-labelledby={`till-incident-group-${group.id}`}>
              <h3 id={`till-incident-group-${group.id}`} className="sales-cap mb-2">
                {t(`groups.${group.id}`)}
              </h3>
              <div className="till-incident-grid">
                {group.tiles.map((tile, tileIndex) => (
                  <TileButton
                    key={tile.id}
                    tile={tile}
                    available={available(tile.id)}
                    onActivate={() => activate(tile.id)}
                    buttonRef={groupIndex === 0 && tileIndex === 0 ? firstTileRef : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
          <LatestIncident />
        </div>
      )}

      {view === 'priceCheck' && (
        <TillProductSearch
          testId="till-incident-price"
          renderResult={match => <TillPriceCheckResult product={match} />}
        />
      )}

      {view !== 'menu' && view !== 'priceCheck' && (
        <TillIncidentReportForm kind={view} initialProduct={product} onSent={onClose} />
      )}
    </Drawer>
  );
}

function TileButton({
  tile,
  available,
  onActivate,
  buttonRef,
}: {
  tile: TillIncidentTile;
  available: boolean;
  onActivate: () => void;
  buttonRef?: Ref<HTMLButtonElement> | undefined;
}) {
  const { t } = useTranslation('tillIncidents');
  const Icon = tile.icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      className="till-incident-tile"
      onClick={onActivate}
      aria-disabled={!available}
      aria-keyshortcuts={tile.letter}
      data-testid={`till-incident-tile-${tile.id}`}
    >
      <span className="flex items-start justify-between">
        <kbd className="pv-kbd till-incident-letter" aria-hidden="true">
          {tile.letter}
        </kbd>
        <Icon className="h-5 w-5 text-fg2" aria-hidden="true" />
      </span>
      <span className="mt-auto block">
        <span className="till-incident-tile-label">{t(`tiles.${tile.id}.label`)}</span>
        <span className="till-incident-tile-detail">
          {available ? t(`tiles.${tile.id}.detail`) : t('unavailable')}
        </span>
      </span>
    </button>
  );
}

function LatestIncident() {
  const { t } = useTranslation('tillIncidents');
  const latest = trpc.registerIncidents.latestToday.useQuery(undefined, { staleTime: 30_000 });
  const row = latest.data;
  if (!row) return null;
  const time = formatDate(row.createdAt, { dateStyle: undefined, timeStyle: 'short' });
  const summary = [t(`kind.${row.kind}`), row.productName ?? row.note, time, row.registerName]
    .filter(Boolean)
    .join(' · ');
  return (
    <p className="flex items-center gap-2 pt-2 text-sm text-fg2" data-testid="till-incident-latest">
      <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
      {t('latest', { summary })}
    </p>
  );
}
