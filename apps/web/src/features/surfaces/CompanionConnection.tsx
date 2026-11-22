import { Radio, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
