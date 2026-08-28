import { roundMoney } from '../../../../lib/money.js';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../../adapter.js';

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function amount(value: number): string {
  return roundMoney(value).toFixed(2);
}

function taxName(code: string): string {
  return code === '04' ? 'INC' : 'IVA';
}

function taxScheme(code: string): string {
  return `<cac:TaxScheme><cbc:ID>${escapeXml(code)}</cbc:ID><cbc:Name>${taxName(code)}</cbc:Name></cac:TaxScheme>`;
}

function taxSubtotal(currency: string, line: FiscalAdapterLine): string {
  const taxable = roundMoney(line.lineTotal - line.taxAmount);
  return `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${escapeXml(currency)}">${amount(taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${escapeXml(currency)}">${amount(line.taxAmount)}</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>${amount(line.taxRate)}</cbc:Percent>${taxScheme(line.taxCategoryCode)}</cac:TaxCategory></cac:TaxSubtotal>`;
}

function documentShape(kind: FiscalAdapterIssueInput['kind']) {
  if (kind === 'NC') {
    return {
      root: 'CreditNote',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
      line: 'CreditNoteLine',
      quantity: 'CreditedQuantity',
      typeElement: 'CreditNoteTypeCode',
      typeCode: '91',
    } as const;
  }
  if (kind === 'ND') {
    return {
      root: 'DebitNote',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
      line: 'DebitNoteLine',
      quantity: 'DebitedQuantity',
      typeElement: 'DebitNoteTypeCode',
      typeCode: '92',
    } as const;
  }
  return {
    root: 'Invoice',
    namespace: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    line: 'InvoiceLine',
    quantity: 'InvoicedQuantity',
    typeElement: 'InvoiceTypeCode',
    typeCode: kind === 'FEV' ? '01' : '02',
  } as const;
}

/**
 * Local UBL 2.1 draft for inspection/interchange only. It is intentionally
 * unsigned and never submitted to DIAN by the mock adapter.
 */
export function buildColombiaUbl21DraftXml(input: FiscalAdapterIssueInput): string {
  const shape = documentShape(input.kind);
  const currency = escapeXml(input.currencyCode);
  const totalTax = roundMoney(input.ivaAmount + input.incAmount + input.icaAmount);
  const lines = input.lines
    .map(line => {
      const lineExtension = roundMoney(line.lineTotal - line.taxAmount);
      const baseUnitPrice =
        line.quantity > 0 ? roundMoney((lineExtension + line.discountAmount) / line.quantity) : 0;
      return `<cac:${shape.line}><cbc:ID>${line.lineNumber}</cbc:ID><cbc:${shape.quantity} unitCode="${escapeXml(line.unitMeasureCode)}">${escapeXml(line.quantity)}</cbc:${shape.quantity}><cbc:LineExtensionAmount currencyID="${currency}">${amount(lineExtension)}</cbc:LineExtensionAmount>${line.discountAmount > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="${currency}">${amount(line.discountAmount)}</cbc:Amount></cac:AllowanceCharge>` : ''}<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${amount(line.taxAmount)}</cbc:TaxAmount>${taxSubtotal(input.currencyCode, line)}</cac:TaxTotal><cac:Item><cbc:Description>${escapeXml(line.productName)}</cbc:Description>${line.productSku ? `<cac:SellersItemIdentification><cbc:ID>${escapeXml(line.productSku)}</cbc:ID></cac:SellersItemIdentification>` : ''}</cac:Item><cac:Price><cbc:PriceAmount currencyID="${currency}">${amount(baseUnitPrice)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="${escapeXml(line.unitMeasureCode)}">1</cbc:BaseQuantity></cac:Price></cac:${shape.line}>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?><${shape.root} xmlns="${shape.namespace}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:CustomizationID>local-unsigned-draft</cbc:CustomizationID><cbc:ProfileID>Puntovivo local inspection draft</cbc:ProfileID><cbc:ProfileExecutionID>${escapeXml(input.environment)}</cbc:ProfileExecutionID><cbc:ID>${escapeXml(input.resolution.documentNumber)}</cbc:ID><cbc:IssueDate>${escapeXml(input.issueDate)}</cbc:IssueDate><cbc:IssueTime>${escapeXml(input.issueTime)}</cbc:IssueTime><cbc:${shape.typeElement}>${shape.typeCode}</cbc:${shape.typeElement}><cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>${escapeXml(input.issuerName ?? input.issuerNit)}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:RegistrationName>${escapeXml(input.issuerName ?? input.issuerNit)}</cbc:RegistrationName><cbc:CompanyID>${escapeXml(input.issuerNit)}</cbc:CompanyID>${taxScheme('01')}</cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>${escapeXml(input.buyer.name)}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:RegistrationName>${escapeXml(input.buyer.name)}</cbc:RegistrationName><cbc:CompanyID>${escapeXml(input.buyer.taxId)}</cbc:CompanyID>${taxScheme('01')}</cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty><cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${amount(totalTax)}</cbc:TaxAmount></cac:TaxTotal><cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${currency}">${amount(input.subtotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="${currency}">${amount(input.subtotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${currency}">${amount(input.totalAmount)}</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount currencyID="${currency}">${amount(input.discountAmount)}</cbc:AllowanceTotalAmount><cbc:PayableAmount currencyID="${currency}">${amount(input.totalAmount)}</cbc:PayableAmount></cac:LegalMonetaryTotal>${lines}</${shape.root}>`;
}
