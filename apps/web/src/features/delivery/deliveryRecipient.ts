export const deliveryInputClass =
  'mt-1 w-full rounded-md border border-line bg-surface-1 p-2 text-secondary-900';

/** The server's limits for each recipient field. */
export const RECIPIENT_MAX_LENGTH = {
  customerName: 160,
  customerPhone: 40,
  address: 500,
  addressNotes: 500,
} as const;

/** The recipient fields of a submitted form, trimmed. */
export function readDeliveryRecipient(fields: FormData) {
  const read = (name: string) => String(fields.get(name) ?? '').trim();
  return {
    customerName: read('customerName'),
    customerPhone: read('customerPhone'),
    address: read('address'),
    addressNotes: read('addressNotes'),
  };
}
