import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MesaPreview {
  id: string;
  name: string;
  seatCount: number | null;
  area: string | null;
  isActive: boolean;
}

interface RestaurantFloorMapPreviewProps {
  tables: readonly MesaPreview[];
  /**
   * Currently selected mesa — surfaced visually with the V2 primary
   * border tint. When undefined the grid renders without a selection.
   */
  selectedId?: string;
  onSelect?: (id: string) => void;
}

/**
 * ENG-087 — V2 floor map preview from the design-system handoff.
 *
 * Sits above the admin CRUD table on RestaurantTablesPage and
 * visualises the mesa catalog as a grid of cards grouped by area.
 * Each card carries:
 *   - the mesa name in a large display font
 *   - a status pill (libre · archivada — derived from `isActive`
 *     until ENG-NNN adds live order state)
 *   - a seat-count line ("Cupo · N pers.")
 *
 * This is read-only today; clicking a card surfaces a selection so
 * the CRUD form below can pre-focus the right row. The richer comanda
 * timeline and live status (en servicio · cuenta · limpieza) ride on
 * top of the existing restaurantTables schema in a follow-up.
 */
export function RestaurantFloorMapPreview({
  tables,
  selectedId,
  onSelect,
}: RestaurantFloorMapPreviewProps) {
  const { t } = useTranslation('restaurants');
  const grouped = useMemo(() => {
    const map = new Map<string, MesaPreview[]>();
    for (const mesa of tables) {
      const key = mesa.area ?? t('floorMap.noAreaLabel', { defaultValue: 'Sin zona' });
      const list = map.get(key);
      if (list) list.push(mesa);
      else map.set(key, [mesa]);
    }
    return [...map.entries()];
  }, [tables, t]);

  if (tables.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="restaurant-floor-map-preview"
      className="card relative mb-6 overflow-hidden p-5 sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 88% 0%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 55%)',
        }}
      />
      <header className="relative flex items-end justify-between gap-3">
        <div>
          <p className="page-kicker">{t('floorMap.kicker', { defaultValue: 'Salón' })}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-[-0.02em] text-secondary-950">
            {t('floorMap.title', { defaultValue: 'Mapa del salón' })}
          </h2>
        </div>
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
          {t('floorMap.count', {
            defaultValue: '{{count}} mesas',
            count: tables.length,
          })}
        </p>
      </header>

      <div className="relative mt-5 space-y-4">
        {grouped.map(([area, mesas]) => (
          <div key={area}>
            <p className="text-[0.55rem] font-semibold uppercase tracking-[0.3em] text-primary-600">
              {area}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {mesas.map(mesa => {
                const selected = mesa.id === selectedId;
                return (
                  <button
                    key={mesa.id}
                    type="button"
                    onClick={() => onSelect?.(mesa.id)}
                    className={cn(
                      'group rounded-2xl border bg-surface/95 p-3 text-left transition-all',
                      selected
                        ? 'border-primary-400 shadow-[0_18px_40px_-28px_color-mix(in_oklch,var(--primary)_55%,transparent)]'
                        : 'border-line/80 hover:border-primary-300 hover:bg-primary-50/40'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="glyph-tile glyph-tile-primary h-9 w-9">
                        <Table2 className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span
                        className={cn(
                          'badge',
                          mesa.isActive ? 'badge-success' : 'badge-secondary'
                        )}
                      >
                        {mesa.isActive
                          ? t('floorMap.status.free', { defaultValue: 'Libre' })
                          : t('floorMap.status.archived', { defaultValue: 'Archivada' })}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-semibold tracking-[-0.01em] text-secondary-950">
                      {mesa.name}
                    </p>
                    <p className="mt-1 text-[0.62rem] uppercase tracking-[0.18em] text-secondary-500">
                      {mesa.seatCount !== null
                        ? t('floorMap.seatCount', {
                            defaultValue: 'Cupo · {{count}} pers.',
                            count: mesa.seatCount,
                          })
                        : t('floorMap.seatCountUnknown', { defaultValue: 'Cupo sin definir' })}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
