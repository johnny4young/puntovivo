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
  const label = resolveStationLabel(
    { code: stationKey, name: orders[0]?.stationName },
    t('station.main')
  );
  return (
    <section className="flex flex-col gap-4" data-testid="kds-station-column">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-200">
        {label} · {t('station.orderCount', { count: orders.length })}
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {orders.map(order => (
          <KdsOrderCard key={order.id} order={order} {...actions} busy={disabled} />
        ))}
      </div>
    </section>
  );
}
