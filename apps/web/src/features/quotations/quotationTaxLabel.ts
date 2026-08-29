import type { QuotationDetailLine } from '@/types';

type QuotationTaxLabelInput = Pick<QuotationDetailLine, 'taxComponents' | 'taxKind' | 'taxRate'>;

/**
 * Render the immutable normalized tax snapshot when present. The scalar
 * taxKind/taxRate pair is only a compatibility summary and cannot describe a
 * mixed-tax line without inventing labels such as IVA 27%.
 */
export function formatQuotationTaxLabel(item: QuotationTaxLabelInput): string {
  if (item.taxComponents && item.taxComponents.length > 0) {
    return [...item.taxComponents]
      .sort((left, right) => left.position - right.position)
      .map(component => `${component.taxKind.toUpperCase()} ${component.taxRate}%`)
      .join(' + ');
  }

  return item.taxRate > 0 ? `${item.taxKind.toUpperCase()} ${item.taxRate}%` : '—';
}
