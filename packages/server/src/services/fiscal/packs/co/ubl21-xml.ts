import { createHash } from 'node:crypto';
import { roundMoney } from '../../../../lib/money.js';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../../adapter.js';
import { computeNitVerificationDigit } from './nit.js';
import { readCoFiscalSettings } from './settings.js';

const DIAN_SCHEME_AGENCY_ID = '195';
const DIAN_SCHEME_AGENCY_NAME = 'CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)';
const DIAN_NIT_TYPE_CODE = '31';
const DIAN_AUTH_PROVIDER_NIT = '800197268';

export interface ColombiaUbl21BuildOptions {
  /** 'draft' preserves local inspection identifiers; 'dian' emits DIAN 1.9 / DEE POS 1.0 profile IDs. */
  mode?: 'draft' | 'dian';
  /** Optional DIAN contingency type 08 metadata (48-hour recovery window). */
  contingency?: {
    typeCode?: '08';
    reason?: string;
    startedAtIso?: string;
    deadlineAtIso?: string;
  };
}

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
  if (code === '04') return 'INC';
  if (code === '03') return 'ICA';
  return 'IVA';
}

function taxScheme(code: string): string {
  return `<cac:TaxScheme><cbc:ID>${escapeXml(code)}</cbc:ID><cbc:Name>${taxName(code)}</cbc:Name></cac:TaxScheme>`;
}

function companyIdAttributes(taxIdTypeCode: string, taxIdDigits: string): string {
  const digits = taxIdDigits.replace(/\D/g, '');
  const dvAttr =
    taxIdTypeCode === DIAN_NIT_TYPE_CODE && digits.length >= 5
      ? ` schemeID="${computeNitVerificationDigit(digits)}"`
      : '';
  return `schemeAgencyID="${DIAN_SCHEME_AGENCY_ID}" schemeAgencyName="${escapeXml(DIAN_SCHEME_AGENCY_NAME)}"${dvAttr} schemeName="${escapeXml(taxIdTypeCode)}"`;
}

function lineTaxComponents(line: FiscalAdapterLine) {
  return line.taxComponents?.length
    ? line.taxComponents
    : [
        {
          componentKey: `legacy:${line.taxCategoryCode}:${line.taxRate}`,
          taxKind: line.taxCategoryCode === '04' ? ('inc' as const) : ('iva' as const),
          taxRate: line.taxRate,
          taxableAmount: roundMoney(line.lineTotal - line.taxAmount),
          taxAmount: line.taxAmount,
          taxCategoryCode: line.taxCategoryCode,
          position: 0,
        },
      ];
}

function lineTaxSubtotals(currency: string, line: FiscalAdapterLine): string {
  return lineTaxComponents(line)
    .map(
      component =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${escapeXml(currency)}">${amount(component.taxableAmount)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${escapeXml(currency)}">${amount(component.taxAmount)}</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>${amount(component.taxRate)}</cbc:Percent>${taxScheme(component.taxCategoryCode)}</cac:TaxCategory></cac:TaxSubtotal>`
    )
    .join('');
}

interface AggregatedTaxBucket {
  schemeCode: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

/**
 * Group document-level TaxTotal blocks by DIAN tax scheme (01 IVA, 04 INC, 03 ICA)
 * and TaxSubtotal rows by (scheme, rate), matching DIAN Anexo Técnico 1.9 / DEE POS 1.0.
 */
function buildHeaderTaxTotals(currency: string, input: FiscalAdapterIssueInput): string {
  const byScheme = new Map<string, Map<string, AggregatedTaxBucket>>();

  for (const line of input.lines) {
    for (const component of lineTaxComponents(line)) {
      const schemeCode = component.taxCategoryCode || '01';
      const rateKey = roundMoney(component.taxRate).toFixed(2);
      let schemeMap = byScheme.get(schemeCode);
      if (!schemeMap) {
        schemeMap = new Map();
        byScheme.set(schemeCode, schemeMap);
      }
      const existing = schemeMap.get(rateKey);
      if (existing) {
        existing.taxableAmount = roundMoney(existing.taxableAmount + component.taxableAmount);
        existing.taxAmount = roundMoney(existing.taxAmount + component.taxAmount);
      } else {
        schemeMap.set(rateKey, {
          schemeCode,
          rate: roundMoney(component.taxRate),
          taxableAmount: roundMoney(component.taxableAmount),
          taxAmount: roundMoney(component.taxAmount),
        });
      }
    }
  }

  if (byScheme.size === 0) {
    return `<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">0.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${amount(input.subtotal)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">0.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>0.00</cbc:Percent>${taxScheme('01')}</cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>`;
  }

  const orderedSchemes = [...byScheme.keys()].sort();
  return orderedSchemes
    .map(schemeCode => {
      const rateMap = byScheme.get(schemeCode)!;
      const buckets = [...rateMap.values()].sort((a, b) => a.rate - b.rate);
      const schemeTotal = roundMoney(buckets.reduce((sum, bucket) => sum + bucket.taxAmount, 0));
      const subtotals = buckets
        .map(
          bucket =>
            `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${amount(bucket.taxableAmount)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${amount(bucket.taxAmount)}</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>${amount(bucket.rate)}</cbc:Percent>${taxScheme(bucket.schemeCode)}</cac:TaxCategory></cac:TaxSubtotal>`
        )
        .join('');
      return `<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${amount(schemeTotal)}</cbc:TaxAmount>${subtotals}</cac:TaxTotal>`;
    })
    .join('');
}

function documentShape(
  kind: FiscalAdapterIssueInput['kind'],
  originalKind: FiscalAdapterIssueInput['originalKind'],
  isContingency: boolean
) {
  const correctsInvoice = originalKind === 'FEV';
  if (kind === 'NC') {
    return {
      root: 'CreditNote',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
      line: 'CreditNoteLine',
      quantity: 'CreditedQuantity',
      typeElement: 'CreditNoteTypeCode',
      // 91 = nota crédito de la factura; 94 = nota de ajuste crédito al documento equivalente.
      typeCode: correctsInvoice ? '91' : '94',
      customizationId: '20',
      profileId: correctsInvoice
        ? 'DIAN 2.1: Nota Crédito de Factura Electrónica de Venta'
        : 'DIAN 2.1: Nota de Ajuste al Documento Equivalente Electrónico',
    } as const;
  }
  if (kind === 'ND') {
    return {
      root: 'DebitNote',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
      line: 'DebitNoteLine',
      quantity: 'DebitedQuantity',
      typeElement: 'DebitNoteTypeCode',
      // 92 = nota débito de la factura; 93 = nota de ajuste débito al documento equivalente.
      typeCode: correctsInvoice ? '92' : '93',
      customizationId: '30',
      profileId: correctsInvoice
        ? 'DIAN 2.1: Nota Débito de Factura Electrónica de Venta'
        : 'DIAN 2.1: Nota de Ajuste Débito al Documento Equivalente Electrónico',
    } as const;
  }
  const typeCode = kind === 'FEV' ? (isContingency ? '03' : '01') : '20';
  return {
    root: 'Invoice',
    namespace: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    line: 'InvoiceLine',
    quantity: 'InvoicedQuantity',
    typeElement: 'InvoiceTypeCode',
    typeCode,
    customizationId: kind === 'FEV' ? '10' : '20',
    profileId:
      kind === 'FEV'
        ? 'DIAN 2.1: Factura Electrónica de Venta'
        : 'DIAN 2.1: Documento Equivalente Electrónico del Tiquete de Máquina Registradora con Sistema P.O.S.',
  } as const;
}

function buildDianExtensions(input: FiscalAdapterIssueInput, documentCode: string): string {
  const settings = readCoFiscalSettings(input.tenantSettings);
  const issuerDigits = input.issuerNit.replace(/\D/g, '');
  const issuerAttrs = companyIdAttributes(DIAN_NIT_TYPE_CODE, issuerDigits);
  const softwareId = settings.softwareId ?? '';
  const softwareSecurityCode =
    softwareId && settings.softwarePin
      ? createHash('sha384')
          .update(`${softwareId}${settings.softwarePin}${input.resolution.documentNumber}`)
          .digest('hex')
      : '';
  const qrHost =
    input.environment === '1'
      ? 'https://catalogo-vpfe.dian.gov.co/document/searchqr'
      : 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr';
  const qrUrl = `${qrHost}?documentkey=${documentCode}`;
  const invoiceControl =
    input.kind === 'FEV' || input.kind === 'DEE'
      ? `<sts:InvoiceControl><sts:InvoiceAuthorization>${escapeXml(input.resolution.resolutionNumber)}</sts:InvoiceAuthorization><sts:AuthorizedInvoices><sts:Prefix>${escapeXml(input.resolution.prefix)}</sts:Prefix></sts:AuthorizedInvoices></sts:InvoiceControl>`
      : '';

  return (
    `<ext:UBLExtensions>` +
    `<ext:UBLExtension><ext:ExtensionContent>` +
    `<sts:DianExtensions>` +
    invoiceControl +
    `<sts:InvoiceSource><cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode></sts:InvoiceSource>` +
    `<sts:SoftwareProvider><sts:ProviderID ${issuerAttrs}>${escapeXml(issuerDigits || input.issuerNit)}</sts:ProviderID><sts:SoftwareID schemeAgencyID="${DIAN_SCHEME_AGENCY_ID}" schemeAgencyName="${escapeXml(DIAN_SCHEME_AGENCY_NAME)}">${escapeXml(softwareId)}</sts:SoftwareID></sts:SoftwareProvider>` +
    `<sts:SoftwareSecurityCode schemeAgencyID="${DIAN_SCHEME_AGENCY_ID}" schemeAgencyName="${escapeXml(DIAN_SCHEME_AGENCY_NAME)}">${escapeXml(softwareSecurityCode)}</sts:SoftwareSecurityCode>` +
    `<sts:AuthorizationProvider><sts:AuthorizationProviderID schemeAgencyID="${DIAN_SCHEME_AGENCY_ID}" schemeAgencyName="${escapeXml(DIAN_SCHEME_AGENCY_NAME)}" schemeID="4" schemeName="31">${DIAN_AUTH_PROVIDER_NIT}</sts:AuthorizationProviderID></sts:AuthorizationProvider>` +
    `<sts:QRCode>${escapeXml(qrUrl)}</sts:QRCode>` +
    `</sts:DianExtensions>` +
    `</ext:ExtensionContent></ext:UBLExtension>` +
    `<ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension>` +
    `</ext:UBLExtensions>`
  );
}

/**
 * Colombia UBL 2.1 XML serializer (FE 1.9 / DEE POS 1.0 / NC / ND / Contingencia 08).
 * In 'draft' mode it preserves the unsigned local inspection CustomizationID;
 * in 'dian' mode it emits the official DIAN profile IDs ready for XAdES-EPES signing.
 */
export function buildColombiaUbl21DraftXml(
  input: FiscalAdapterIssueInput,
  documentCode: string,
  options: ColombiaUbl21BuildOptions = {}
): string {
  const mode = options.mode ?? 'draft';
  const isContingency = Boolean(options.contingency);
  const shape = documentShape(input.kind, input.originalKind, isContingency);
  const scheme = input.kind === 'FEV' ? 'CUFE-SHA384' : 'CUDE-SHA384';
  const uuid = `<cbc:UUID schemeID="${escapeXml(input.environment)}" schemeName="${scheme}">${escapeXml(documentCode)}</cbc:UUID>`;
  const currency = escapeXml(input.currencyCode);

  const lineDiscountSum = roundMoney(
    input.lines.reduce((sum, line) => sum + Math.max(0, line.discountAmount), 0)
  );
  // Only discounts above per-line discounts belong to header AllowanceTotalAmount,
  // preserving PayableAmount = TaxInclusiveAmount - AllowanceTotalAmount + ChargeTotalAmount.
  const headerAllowance = Math.max(0, roundMoney(input.discountAmount - lineDiscountSum));
  const taxInclusiveAmount = roundMoney(input.totalAmount + headerAllowance);
  const payableAmount = roundMoney(taxInclusiveAmount - headerAllowance);

  const headerAllowanceXml =
    headerAllowance > 0
      ? `<cac:AllowanceCharge><cbc:ID>1</cbc:ID><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:AllowanceChargeReasonCode>00</cbc:AllowanceChargeReasonCode><cbc:AllowanceChargeReason>Descuento comercial</cbc:AllowanceChargeReason><cbc:Amount currencyID="${currency}">${amount(headerAllowance)}</cbc:Amount><cbc:BaseAmount currencyID="${currency}">${amount(taxInclusiveAmount)}</cbc:BaseAmount></cac:AllowanceCharge>`
      : '';

  const contingencyNoteXml = options.contingency
    ? `<cbc:Note>${escapeXml(
        `CONTINGENCIA_TIPO_${options.contingency.typeCode ?? '08'}` +
          (options.contingency.reason ? ` · ${options.contingency.reason}` : '') +
          (options.contingency.deadlineAtIso
            ? ` · Plazo 48h: ${options.contingency.deadlineAtIso}`
            : '')
      )}</cbc:Note>`
    : '';

  const billingReferenceXml =
    (input.kind === 'NC' || input.kind === 'ND') && input.originalCufe
      ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${escapeXml(input.resolution.documentNumber)}</cbc:ID><cbc:UUID schemeName="${input.originalKind === 'FEV' ? 'CUFE-SHA384' : 'CUDE-SHA384'}">${escapeXml(input.originalCufe)}</cbc:UUID></cac:InvoiceDocumentReference></cac:BillingReference>`
      : '';

  const issuerAttrs = companyIdAttributes(DIAN_NIT_TYPE_CODE, input.issuerNit);
  const buyerAttrs = companyIdAttributes(input.buyer.taxIdTypeCode, input.buyer.taxId);

  const lines = input.lines
    .map(line => {
      const lineExtension = roundMoney(line.lineTotal - line.taxAmount);
      const baseUnitPrice =
        line.quantity > 0 ? roundMoney((lineExtension + line.discountAmount) / line.quantity) : 0;
      return `<cac:${shape.line}><cbc:ID>${line.lineNumber}</cbc:ID><cbc:${shape.quantity} unitCode="${escapeXml(line.unitMeasureCode)}">${escapeXml(line.quantity)}</cbc:${shape.quantity}><cbc:LineExtensionAmount currencyID="${currency}">${amount(lineExtension)}</cbc:LineExtensionAmount>${line.discountAmount > 0 ? `<cac:AllowanceCharge><cbc:ID>1</cbc:ID><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="${currency}">${amount(line.discountAmount)}</cbc:Amount></cac:AllowanceCharge>` : ''}<cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${amount(line.taxAmount)}</cbc:TaxAmount>${lineTaxSubtotals(input.currencyCode, line)}</cac:TaxTotal><cac:Item><cbc:Description>${escapeXml(line.productName)}</cbc:Description>${line.productSku ? `<cac:SellersItemIdentification><cbc:ID>${escapeXml(line.productSku)}</cbc:ID></cac:SellersItemIdentification>` : ''}</cac:Item><cac:Price><cbc:PriceAmount currencyID="${currency}">${amount(baseUnitPrice)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="${escapeXml(line.unitMeasureCode)}">1</cbc:BaseQuantity></cac:Price></cac:${shape.line}>`;
    })
    .join('');

  const customizationId = mode === 'dian' ? shape.customizationId : 'local-unsigned-draft';
  const profileId = mode === 'dian' ? shape.profileId : 'Puntovivo local inspection draft';
  const headerTaxTotals = buildHeaderTaxTotals(currency, input);
  const dianExtensions = buildDianExtensions(input, documentCode);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${shape.root}` +
    ` xmlns="${shape.namespace}"` +
    ` xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"` +
    ` xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"` +
    ` xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` +
    ` xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"` +
    ` xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"` +
    ` xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` +
    ` xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    dianExtensions +
    `<cbc:UBLVersionID>2.1</cbc:UBLVersionID>` +
    `<cbc:CustomizationID>${escapeXml(customizationId)}</cbc:CustomizationID>` +
    `<cbc:ProfileID>${escapeXml(profileId)}</cbc:ProfileID>` +
    `<cbc:ProfileExecutionID>${escapeXml(input.environment)}</cbc:ProfileExecutionID>` +
    `<cbc:ID>${escapeXml(input.resolution.documentNumber)}</cbc:ID>` +
    uuid +
    `<cbc:IssueDate>${escapeXml(input.issueDate)}</cbc:IssueDate>` +
    `<cbc:IssueTime>${escapeXml(input.issueTime)}</cbc:IssueTime>` +
    `<cbc:${shape.typeElement}>${shape.typeCode}</cbc:${shape.typeElement}>` +
    contingencyNoteXml +
    `<cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>` +
    `<cbc:LineCountNumeric>${input.lines.length}</cbc:LineCountNumeric>` +
    billingReferenceXml +
    `<cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>${escapeXml(input.issuerName ?? input.issuerNit)}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:RegistrationName>${escapeXml(input.issuerName ?? input.issuerNit)}</cbc:RegistrationName><cbc:CompanyID ${issuerAttrs}>${escapeXml(input.issuerNit)}</cbc:CompanyID>${taxScheme('01')}</cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>` +
    `<cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>${escapeXml(input.buyer.name)}</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:RegistrationName>${escapeXml(input.buyer.name)}</cbc:RegistrationName><cbc:CompanyID ${buyerAttrs}>${escapeXml(input.buyer.taxId)}</cbc:CompanyID>${taxScheme('01')}</cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>` +
    headerAllowanceXml +
    headerTaxTotals +
    `<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="${currency}">${amount(input.subtotal)}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="${currency}">${amount(input.subtotal)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${currency}">${amount(taxInclusiveAmount)}</cbc:TaxInclusiveAmount><cbc:AllowanceTotalAmount currencyID="${currency}">${amount(headerAllowance)}</cbc:AllowanceTotalAmount><cbc:PayableAmount currencyID="${currency}">${amount(payableAmount)}</cbc:PayableAmount></cac:LegalMonetaryTotal>` +
    lines +
    `</${shape.root}>`
  );
}
