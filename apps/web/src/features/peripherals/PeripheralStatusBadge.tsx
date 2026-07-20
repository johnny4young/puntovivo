import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';

/**
 * Peripheral last-test-result chip.
 *
 * Maps the persisted `last_test_result` enum (`'ok' | 'failed' | null`)
 * to a Badge variant + translated label. Renders the timestamp under
 * the chip so the operator can spot stale tests at a glance.
 */
interface PeripheralStatusBadgeProps {
  lastTestResult: 'ok' | 'failed' | null;
  lastTestedAt: string | null;
}

export function PeripheralStatusBadge({
  lastTestResult,
  lastTestedAt,
}: PeripheralStatusBadgeProps) {
  const { t, i18n } = useTranslation('peripherals');

  const variant =
    lastTestResult === 'ok' ? 'success' : lastTestResult === 'failed' ? 'danger' : 'secondary';

  const label =
    lastTestResult === 'ok'
      ? t('status.ok')
      : lastTestResult === 'failed'
        ? t('status.failed')
        : t('status.untested');

  const formattedTimestamp = lastTestedAt
    ? new Date(lastTestedAt).toLocaleString(i18n.language)
    : null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={variant}>{label}</Badge>
      {formattedTimestamp && (
        <span className="text-[0.7rem] text-secondary-500">
          {t('status.lastTestedAt', { when: formattedTimestamp })}
        </span>
      )}
    </div>
  );
}
