import { useTranslation } from 'react-i18next';
import { deliveryInputClass, RECIPIENT_MAX_LENGTH as MAX } from './deliveryRecipient';

interface DeliveryRecipientDefaults {
  customerName?: string | undefined;
  customerPhone?: string | undefined;
  address?: string | undefined;
}

/** Recipient inputs read through FormData: customerName, customerPhone, address, addressNotes. */
export function DeliveryRecipientFields({
  idPrefix,
  defaults = {},
}: {
  idPrefix: string;
  defaults?: DeliveryRecipientDefaults;
}) {
  const { t } = useTranslation('delivery');
  // Browsers do not enforce maxLength on a default value, so an over-long one is left out.
  const fit = (value: string | undefined, max: number) =>
    value && value.length <= max ? value : undefined;
  return (
    <>
      <label className="block" htmlFor={`${idPrefix}-name`}>
        {t('create.recipient')}
        <input
          id={`${idPrefix}-name`}
          name="customerName"
          required
          maxLength={MAX.customerName}
          autoComplete="name"
          defaultValue={fit(defaults.customerName, MAX.customerName)}
          className={deliveryInputClass}
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-phone`}>
        {t('detail.phoneLabel')}
        <input
          id={`${idPrefix}-phone`}
          name="customerPhone"
          type="tel"
          maxLength={MAX.customerPhone}
          autoComplete="tel"
          defaultValue={fit(defaults.customerPhone, MAX.customerPhone)}
          className={deliveryInputClass}
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-address`}>
        {t('detail.addressLabel')}
        <input
          id={`${idPrefix}-address`}
          name="address"
          required
          maxLength={MAX.address}
          autoComplete="street-address"
          defaultValue={fit(defaults.address, MAX.address)}
          className={deliveryInputClass}
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-notes`}>
        {t('detail.addressNotesLabel')}
        <textarea
          id={`${idPrefix}-notes`}
          name="addressNotes"
          maxLength={MAX.addressNotes}
          className={deliveryInputClass}
        />
      </label>
    </>
  );
}
