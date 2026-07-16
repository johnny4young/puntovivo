export function buildLossPreventionWhatsAppUrl(args: {
  recipientPhone: string;
  message: string;
}): string {
  const recipient = args.recipientPhone.replace(/\D/g, '');
  return `https://wa.me/${recipient}?text=${encodeURIComponent(args.message)}`;
}
