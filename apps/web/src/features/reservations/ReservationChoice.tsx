import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ArrivedReservationChoice } from './reservationSelection';
/** Opening a check consumes a reservation only after this explicit operator selection. */
export function ReservationChoice({
  row,
  checked,
  disabled,
  onChange,
}: {
  row: ArrivedReservationChoice;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation('restaurants');
  return (
    <div className="rounded border border-line bg-surface-1 p-3 text-sm">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
        <span>{t('reservationChoice.confirm', { name: row.guestName, count: row.partySize })}</span>
      </label>
      <p className="mt-2 text-secondary-700">{t('reservationChoice.hint')}</p>
      <Link className="mt-2 inline-block text-primary-700 underline" to="/reservations">
        {t('reservationChoice.manage')}
      </Link>
    </div>
  );
}
