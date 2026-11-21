import { useTranslation } from 'react-i18next';
import { deliveryInputClass } from './deliveryRecipient';

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
  return (
    <>
      <label className="block" htmlFor={`${idPrefix}-name`}>
        {t('create.recipient')}
        <input
          id={`${idPrefix}-name`}
          name="customerName"
          required
          maxLength={160}
          autoComplete="name"
          defaultValue={defaults.customerName}
          className={deliveryInputClass}
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-phone`}>
        {t('detail.phoneLabel')}
        <input
          id={`${idPrefix}-phone`}
          name="customerPhone"
          type="tel"
          maxLength={40}
          autoComplete="tel"
          defaultValue={defaults.customerPhone}
          className={deliveryInputClass}
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-address`}>
        {t('detail.addressLabel')}
        <input
          id={`${idPrefix}-address`}
          name="address"
          required
          maxLength={500}
          autoComplete="street-address"
          defaultValue={defaults.address}
          className={deliveryInputClass}
        />
      </label>
      <label className="block" htmlFor={`${idPrefix}-notes`}>
        {t('detail.addressNotesLabel')}
        <textarea
          id={`${idPrefix}-notes`}
          name="addressNotes"
          maxLength={500}
          className={deliveryInputClass}
        />
      </label>
    </>
  );
}
