import { Radio, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { LiveState } from './useCompanionLive';

export function CompanionConnection({ liveState }: { liveState: LiveState }) {
  const { t } = useTranslation('companion');
  return (
    <p
      className={`flex items-center gap-1.5 text-sm ${
        liveState === 'open' ? 'text-success-700' : 'text-fg3'
      }`}
      data-testid="companion-connection"
      role="status"
    >
      {liveState === 'open' ? (
        <Radio className="h-4 w-4" aria-hidden="true" />
      ) : (
        <WifiOff className="h-4 w-4" aria-hidden="true" />
      )}
      {t(`connection.${liveState}`)}
    </p>
  );
}

/** The live state as the pill beside an owner screen's title. */
export function CompanionLivePill({ liveState }: { liveState: LiveState }) {
  return (
    <div
      className={cn(
        'shrink-0 rounded-full px-3 py-1',
        liveState === 'open' ? 'bg-success-50' : 'bg-surface-2'
      )}
    >
      <CompanionConnection liveState={liveState} />
    </div>
  );
}
