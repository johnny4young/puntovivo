/**
 * one column per kitchen station.
 *
 * v1 always renders exactly one column ("Cocina") because every
 * `kds_orders` row is enqueued with `station='main'`. The component
 * already supports multiple columns so the future product-station
 * tagging follow-up only has to populate the schema field.
 */

import { useTranslation } from 'react-i18next';
import { KdsOrderCard, type KdsCardData } from './KdsOrderCard';

export interface KdsStationColumnProps {
  stationKey: string;
  orders: KdsCardData[];
  onReady: (orderId: string) => void;
  onRecall: (orderId: string) => void;
  busyOrderId?: string | null;
}

const STATION_LABEL_KEY: Record<string, string> = {
  main: 'station.main',
};

export function KdsStationColumn({
  stationKey,
  orders,
  onReady,
  onRecall,
  busyOrderId,
}: KdsStationColumnProps) {
  const { t } = useTranslation('kds');
  const labelKey = STATION_LABEL_KEY[stationKey] ?? 'station.unknown';

  return (
    <section className="flex flex-col gap-4" data-testid="kds-station-column">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-200">
        {t(labelKey)} · {t('station.orderCount', { count: orders.length })}
      </h2>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
        {orders.map(order => (
          <KdsOrderCard
            key={order.id}
            order={order}
            onReady={onReady}
            onRecall={onRecall}
            busy={busyOrderId === order.id}
          />
        ))}
      </div>
    </section>
  );
}
