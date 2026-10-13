/**
 * i18n key (in the `receipts` namespace) naming a certified fiscal
 * document's authority identifier. DIAN only calls the sales invoice's
 * code a CUFE; the POS documento equivalente and every note carry a CUDE.
 */
export function fiscalIdentifierLabelKey(countryCode: string, kind: string): string {
  switch (countryCode.toUpperCase()) {
    case 'MX':
      return 'receipts:fiscal.uuidLabel';
    case 'CL':
      return 'receipts:fiscal.tedLabel';
    default:
      return kind === 'FEV' ? 'receipts:fiscal.cufeLabel' : 'receipts:fiscal.cudeLabel';
  }
}
