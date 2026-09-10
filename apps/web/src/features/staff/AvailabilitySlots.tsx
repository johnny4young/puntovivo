import { useTranslation } from 'react-i18next';
import { formatAvailabilityMinute, type AvailabilitySlot } from './availabilityTypes';
/** Frozen local-day slots stay readable across device/tenant timezone changes. */
export function AvailabilitySlots({ slots }: { slots: AvailabilitySlot[] }) {
  const { t } = useTranslation('availability');
  if (!slots.length) return <p className="text-sm font-medium">{t('emptyWeek')}</p>;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {slots.map((slot, index) => (
        <li key={`${slot.weekday}:${slot.startMinute}:${index}`}>
          {t(`days.${slot.weekday}`)} · {formatAvailabilityMinute(slot.startMinute)}–
          {formatAvailabilityMinute(slot.endMinute)}
        </li>
      ))}
    </ul>
  );
}
