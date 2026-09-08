/** Site-local station grouping. Ticket station labels remain frozen at dispatch. */
import { useTranslation } from 'react-i18next';
import { KdsOrderCard } from './KdsOrderCard';
import type { KdsActions, KdsCardData } from './types';
import { resolveStationLabel } from './stationLabel';
/** One column receives only its station's current page of kitchen tickets. */
export interface KdsStationColumnProps extends KdsActions {
  stationKey: string;
  orders: KdsCardData[];
  disabled: boolean;
}
export function KdsStationColumn({
  stationKey,
  orders,
  disabled,
  ...actions
}: KdsStationColumnProps) {
  const { t } = useTranslation('kds');
  // Station labels are FROZEN on the ticket at dispatch, so a rename mid
  // service leaves old and new tickets in this column carrying different
  // names. Taking the first ticket's name labelled the whole column with it
  // and mislabelled the other group. Claim a name only when every ticket
  // agrees on it; otherwise fall back to the code and let each card state its
  // own frozen name, which keeps one column per physical station instead of
  // splitting the cook's board in half over a rename.
  const frozenNames = new Set(
    orders.map(order => order.stationName?.trim()).filter((name): name is string => !!name)
  );
  const agreedName = frozenNames.size === 1 ? [...frozenNames][0] : undefined;
  const label = resolveStationLabel({ code: stationKey, name: agreedName }, t('station.main'));
  const stationNameDisputed = frozenNames.size > 1;
  return (
    <section className="flex flex-col gap-4" data-testid="kds-station-column">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-200">
        {label} · {t('station.orderCount', { count: orders.length })}
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {orders.map(order => (
          <KdsOrderCard
            key={order.id}
            order={order}
            {...actions}
            busy={disabled}
            showFrozenStation={stationNameDisputed}
          />
        ))}
      </div>
    </section>
  );
}
