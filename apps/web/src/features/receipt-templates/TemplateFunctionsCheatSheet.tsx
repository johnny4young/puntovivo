import { useTranslation } from 'react-i18next';

/**
 * pass 3 (item #3) — the whitelisted template-function registry
 * mirrored client-side. Signatures + canonical examples live in code so
 * they stay in lockstep with the server function registry; only the
 * one-line description per function is translated.
 */
const TEMPLATE_FUNCTION_REFERENCE: ReadonlyArray<{
  name:
    | 'currency'
    | 'date'
    | 'upper'
    | 'lower'
    | 'round'
    | 'limit'
    | 'concat'
    | 'default'
    | 'abs'
    | 'max'
    | 'min'
    | 'sum';
  signature: string;
  example: string;
}> = [
  {
    name: 'currency',
    signature: 'currency(value, decimals?)',
    example: '{{ currency(sale.grandTotal) }}',
  },
  {
    name: 'date',
    signature: 'date(value, pattern?)',
    example: "{{ date(sale.createdAt, 'dd/MM/yyyy') }}",
  },
  { name: 'upper', signature: 'upper(value)', example: '{{ upper(company.name) }}' },
  { name: 'lower', signature: 'lower(value)', example: '{{ lower(sale.cashier) }}' },
  {
    name: 'round',
    signature: 'round(value, decimals?)',
    example: '{{ round(sale.grandTotal, 2) }}',
  },
  { name: 'limit', signature: 'limit(value, n)', example: '{{ limit(sale.notes, 30) }}' },
  { name: 'concat', signature: 'concat(a, b, …)', example: "{{ concat('Caja: ', sale.cashier) }}" },
  {
    name: 'default',
    signature: 'default(value, fallback)',
    example: "{{ default(fiscal.cufe, 'Sin CUFE') }}",
  },
  { name: 'abs', signature: 'abs(value)', example: '{{ abs(sale.discount) }}' },
  { name: 'max', signature: 'max(a, b, …)', example: '{{ max(sale.grandTotal, 0) }}' },
  { name: 'min', signature: 'min(a, b, …)', example: '{{ min(sale.discount, 100) }}' },
  { name: 'sum', signature: 'sum(a, b, …)', example: '{{ sum(sale.subtotal, sale.taxTotal) }}' },
];

/**
 * pass 3 (item #3) — collapsible reference of every whitelisted
 * template function, shown inside the text-block form. Items #2 (rich
 * autocomplete) and #7 (in-preview error markers) will eventually replace
 * this static panel with an integrated tooltip; until then operators can
 * scan this list to learn the syntax without leaving the editor.
 */
export function TemplateFunctionsCheatSheet() {
  const { t } = useTranslation('receiptTemplates');
  return (
    <details
      className="rounded border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-secondary-700"
      data-testid="template-functions-cheatsheet"
    >
      <summary className="cursor-pointer font-medium">{t('editor.functionsHelp.title')}</summary>
      <p className="mt-2 text-secondary-600">{t('editor.functionsHelp.intro')}</p>
      <ul className="mt-2 space-y-2">
        {TEMPLATE_FUNCTION_REFERENCE.map(fn => (
          <li key={fn.name} className="space-y-0.5">
            <code className="block text-[0.7rem] font-medium text-secondary-900">
              {fn.signature}
            </code>
            <span className="block text-secondary-600">
              {t(`editor.functionsHelp.entries.${fn.name}`)}
            </span>
            <code className="block text-[0.7rem] text-primary-700">{fn.example}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
