/**
 * ENG-088 — Offline V12 mode panel.
 *
 * Wraps the existing `OfflineCapabilityGrid` (slice 1, shipped
 * in `e97cdc8`) and the new `OfflineSyncQueueList` inside one
 * cohesive surface. Mounted by `GlobalStatusStrip` inside the
 * expanded notification center when the device is offline or the hub is
 * unreachable.
 *
 * Layout:
 *  - Above 1024 px (lg): 2-col grid — capability grid (5/12) +
 *    sync queue list (7/12).
 *  - Below 1024 px: stacks vertically so tablet portrait and
 *    mobile keep their full width.
 *
 * Visibility:
 *  - The `visible` prop mirrors `showCapabilityGrid` in
 *    the strip (`!isOnline || hubUnreachable`). When false the
 *    component renders nothing so the surface stays dead chrome
 *    on healthy connections.
 */
import { useTranslation } from 'react-i18next';
import { OfflineCapabilityGrid } from './OfflineCapabilityGrid';
import { OfflineSyncQueueList } from './OfflineSyncQueueList';

interface OfflineModePanelProps {
  visible: boolean;
}

export function OfflineModePanel({ visible }: OfflineModePanelProps) {
  const { t } = useTranslation('common');
  if (!visible) return null;

  return (
    <div data-testid="offline-mode-panel" className="space-y-3">
      <p
        data-testid="offline-mode-reassurance"
        className="rounded-2xl border border-warning-300/60 bg-warning-50/60 px-4 py-2 text-sm font-medium text-warning-700"
      >
        {t('offlineGrid.reassurance')}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <OfflineCapabilityGrid visible={true} />
        </div>
        <div className="lg:col-span-7">
          <OfflineSyncQueueList />
        </div>
      </div>
    </div>
  );
}
