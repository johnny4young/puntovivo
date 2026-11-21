export const deliveryInputClass =
  'mt-1 w-full rounded-md border border-line bg-surface-1 p-2 text-secondary-900';

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
