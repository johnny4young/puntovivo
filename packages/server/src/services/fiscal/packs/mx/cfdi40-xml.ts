/**
 * ENG-035b — Serializador de XML CFDI 4.0 según Anexo 20 SAT.
 *
 * Construye un comprobante CFDI 4.0 estructuralmente válido a
 * partir del input estándar del orchestrator
 * (`FiscalAdapterIssueInput`) y los settings MX del tenant. El
 * resultado:
 *
 * - Genera un UUID local con `crypto.randomUUID()` como
 *   placeholder. El folio fiscal real (UUID asignado por el SAT
 *   al timbrar) llega con ENG-035c cuando integremos PAC.
 * - Devuelve un string XML serializado listo para persistir en
 *   `fiscal_documents.xml_ref`.
 * - NO firma con CSD ni transmite al PAC. El XML queda en estado
 *   "draft" representado en el schema con `status='pending'`.
 *
 * Cobertura del Anexo 20 implementada:
 *
 * - cfdi:Comprobante root con todos los atributos requeridos
 *   (Version, Serie, Folio, Fecha, FormaPago, NoCertificado vacío,
 *   SubTotal, Moneda, Total, TipoDeComprobante, MetodoPago,
 *   LugarExpedicion, Exportacion, Sello vacío) + namespaces
 *   `xmlns:cfdi` + `xmlns:xsi` + `xsi:schemaLocation`.
 * - cfdi:Emisor con Rfc, Nombre, RegimenFiscal del catálogo SAT.
 * - cfdi:Receptor con Rfc, Nombre, DomicilioFiscalReceptor,
 *   RegimenFiscalReceptor, UsoCFDI. Consumidor final usa
 *   XAXX010101000 + S01; foreign buyer usa XEXX010101000 + S01.
 * - cfdi:Conceptos > cfdi:Concepto[] con ClaveProdServ,
 *   NoIdentificacion (sku), Cantidad, ClaveUnidad, Descripcion,
 *   ValorUnitario, Importe, Descuento, ObjetoImp, y nested
 *   cfdi:Impuestos > cfdi:Traslados > cfdi:Traslado.
 * - cfdi:Comprobante.cfdi:Impuestos agregado con
 *   TotalImpuestosTrasladados + suma de Traslados consolidados.
 * - cfdi:CfdiRelacionados (TipoRelacion='01' Nota crédito) cuando
 *   source='return' u source='void' con originalCufe en input.
 *
 * Cobertura DIFERIDA (out of scope para ENG-035b):
 *
 * - Firmado XAdES con CSD: ENG-035c.
 * - Sello SAT y NoCertificado real: timbrado PAC, ENG-035c.
 * - cfdi:Pagos 2.0 para parcialidades / crédito: ENG-035c.
 * - CartaPorte (transporte de mercancías): fuera de scope LATAM.
 * - ComercioExterior (exportación): fuera de scope retail base.
 * - TipoCambio para foreign currency: el adapter rechaza si
 *   currencyCode !== 'MXN' (se modela en ENG-035c con tabla de
 *   tipos de cambio del Banco de México).
 * - IEPS para alcohol y tabaco: el catálogo claveProdServ marca
 *   las categorías; el cálculo IEPS lo agrega ENG-035c con tasas
 *   vigentes SAT.
 *
 * @module services/fiscal/packs/mx/cfdi40-xml
 */

import { randomUUID } from 'node:crypto';
import { XMLBuilder } from 'fast-xml-parser';
import type {
  FiscalAdapterIssueInput,
  FiscalAdapterLine,
} from '../../adapter.js';
import { findRegimenFiscal } from './catalogs/index.js';
import {
  formatDecimal,
  inferProductClaveProdServ,
  mapPaymentMethodToFormaPago,
  mapTaxRateToTraslado,
  mapUnitToClaveUnidad,
  type TrasladoData,
} from './mappings.js';
import type { MxFiscalSettings } from './settings.js';

/**
 * Resultado de la serialización: el UUID generado localmente y el
 * string XML listo para persistir.
 */
export interface SerializedCfdi40 {
  /** UUID v4 local (placeholder hasta que ENG-035c lo reemplace por el folio fiscal SAT). */
  uuid: string;
  /** XML CFDI 4.0 serializado, encoding UTF-8, listo para almacenar en `fiscal_documents.xml_ref`. */
  xml: string;
  /** Datos del emisor que el adapter persiste como contexto para auditoría. */
  emisorRfc: string;
  /** Datos del receptor (consumidor final genérico vs foreign vs cliente registrado). */
  receptorRfc: string;
  /** Tipo de comprobante CFDI ('I' = ingreso, 'E' = egreso). Útil para tests. */
  tipoComprobante: 'I' | 'E';
}

/**
 * Constantes SAT genéricas usadas cuando el receptor no es un
 * cliente registrado mexicano.
 */
const RECEPTOR_GENERICO = {
  rfcMexicano: 'XAXX010101000',
  rfcExtranjero: 'XEXX010101000',
  nombre: 'PUBLICO EN GENERAL',
  usoCfdiPublicoGeneral: 'S01',
  /** ResidenciaFiscal cuando el receptor es extranjero. ISO 3166-1 alpha-3. */
  residenciaFiscalDefault: 'USA',
  /** NumRegIdTrib cuando es extranjero — placeholder operativo. */
  numRegIdTribDefault: '0000000000',
} as const;

/** Régimen fiscal por default para el receptor "Público en general". */
const REGIMEN_RECEPTOR_PUBLICO_GENERAL = '616';

/** Tipo de relación SAT para nota de crédito: '01' Nota de crédito. */
const TIPO_RELACION_NC = '01';

/**
 * Serializa un comprobante CFDI 4.0 estructuralmente válido. La
 * función es pura — no toca DB ni red, solo transforma el input
 * en string.
 *
 * @param input Datos del documento del orchestrator.
 * @param settings Settings fiscales MX del tenant.
 * @param emisorName Nombre legal del emisor (de `companies.legalName`).
 * @returns UUID + XML serializado.
 */
export function serializeCfdi40(
  input: FiscalAdapterIssueInput,
  settings: MxFiscalSettings,
  emisorName: string
): SerializedCfdi40 {
  // -----------------------------------------------------------
  // Validaciones defensivas.
  // -----------------------------------------------------------
  if (input.lines.length === 0) {
    throw new Error('CFDI 4.0 requiere al menos un concepto; lines vacío.', {
      cause: {
        country: 'MX',
        document: 'CFDI40',
        missing: 'lines',
        tenantId: input.tenantId,
      },
    });
  }
  if (input.currencyCode !== 'MXN') {
    throw new Error(
      `CFDI 4.0 requiere Moneda='MXN'. Recibido: ${input.currencyCode}. Foreign currency requiere TipoCambio (ENG-035c).`,
      {
        cause: {
          country: 'MX',
          document: 'CFDI40',
          unsupportedCurrency: input.currencyCode,
          tenantId: input.tenantId,
        },
      }
    );
  }
  if (!settings.rfc) {
    throw new Error('CFDI 4.0 requiere RFC del emisor en tenant settings.', {
      cause: {
        country: 'MX',
        document: 'CFDI40',
        missing: 'settings.rfc',
        tenantId: input.tenantId,
      },
    });
  }
  if (!settings.regimenFiscalCode) {
    throw new Error('CFDI 4.0 requiere RegimenFiscal del emisor en tenant settings.', {
      cause: {
        country: 'MX',
        document: 'CFDI40',
        missing: 'settings.regimenFiscalCode',
        tenantId: input.tenantId,
      },
    });
  }
  if (!settings.lugarExpedicion) {
    throw new Error('CFDI 4.0 requiere LugarExpedicion del emisor en tenant settings.', {
      cause: {
        country: 'MX',
        document: 'CFDI40',
        missing: 'settings.lugarExpedicion',
        tenantId: input.tenantId,
      },
    });
  }
  const regimen = findRegimenFiscal(settings.regimenFiscalCode);
  if (!regimen) {
    throw new Error(
      `RegimenFiscal ${settings.regimenFiscalCode} no existe en el catálogo SAT.`,
      {
        cause: {
          country: 'MX',
          document: 'CFDI40',
          catalog: 'c_RegimenFiscal',
          missingCode: settings.regimenFiscalCode,
          tenantId: input.tenantId,
        },
      }
    );
  }

  // -----------------------------------------------------------
  // Tipo de comprobante: 'I' Ingreso para ventas; 'E' Egreso para
  // returns o voids (Nota de crédito en taxonomía SAT).
  // -----------------------------------------------------------
  const tipoComprobante: 'I' | 'E' =
    input.source === 'sale' ? 'I' : 'E';

  // -----------------------------------------------------------
  // UUID local (placeholder hasta ENG-035c PAC timbrado).
  // -----------------------------------------------------------
  const uuid = randomUUID();

  // -----------------------------------------------------------
  // Receptor: cliente registrado vs consumidor final vs foreign.
  // -----------------------------------------------------------
  const receptor = buildReceptor(input, settings.lugarExpedicion);

  // -----------------------------------------------------------
  // Forma / método de pago: para venta pagada en POS usamos PUE +
  // la forma real dominante. Sólo ventas a crédito/diferidas usan
  // PPD + 99 Por definir.
  // -----------------------------------------------------------
  const isDeferredPayment =
    input.source === 'sale' && input.paymentMethod === 'credit';
  const formaPago = mapPaymentMethodToFormaPago(
    isDeferredPayment ? 'credit' : input.paymentMethod ?? 'cash'
  );
  const metodoPago = isDeferredPayment ? 'PPD' : 'PUE';

  // -----------------------------------------------------------
  // Conceptos: cada line del input se vuelve un cfdi:Concepto
  // con sus impuestos por concepto.
  // -----------------------------------------------------------
  const conceptos = input.lines.map(line => buildConcepto(line));

  // -----------------------------------------------------------
  // Impuestos agregados al nivel comprobante. Sumamos los
  // Traslados de cada concepto consolidando por
  // (Impuesto, TipoFactor, TasaOCuota) — el SAT pide
  // consolidación.
  // -----------------------------------------------------------
  const impuestosAgregados = consolidateImpuestos(input.lines);

  // -----------------------------------------------------------
  // Build del JSON intermedio que fast-xml-parser convierte a XML.
  // Usamos prefix '@_' para atributos y '#text' para contenido —
  // configurado abajo en el XMLBuilder.
  // -----------------------------------------------------------
  type AttrRecord = Record<string, string>;
  type CfdiNode = Record<string, unknown>;

  const comprobanteAttrs: AttrRecord = {
    '@_xmlns:cfdi': 'http://www.sat.gob.mx/cfd/4',
    '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    '@_xsi:schemaLocation':
      'http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd',
    '@_Version': '4.0',
    '@_Serie': input.resolution.prefix || 'F',
    '@_Folio': input.resolution.consecutive.toString(),
    '@_Fecha': formatFechaCfdi(input.issueDate, input.issueTime),
    '@_FormaPago': formaPago.code,
    '@_NoCertificado': '',
    '@_SubTotal': formatDecimal(input.subtotal, 2),
    '@_Moneda': 'MXN',
    '@_Total': formatDecimal(input.totalAmount, 2),
    '@_TipoDeComprobante': tipoComprobante,
    '@_MetodoPago': metodoPago,
    '@_LugarExpedicion': settings.lugarExpedicion,
    '@_Exportacion': '01',
    '@_Sello': '',
  };

  if (input.discountAmount > 0) {
    comprobanteAttrs['@_Descuento'] = formatDecimal(input.discountAmount, 2);
  }

  const comprobanteRoot: CfdiNode = {
    ...comprobanteAttrs,
  };

  // CfdiRelacionados (notas de crédito + voids con originalCufe).
  if (input.originalCufe && tipoComprobante === 'E') {
    comprobanteRoot['cfdi:CfdiRelacionados'] = {
      '@_TipoRelacion': TIPO_RELACION_NC,
      'cfdi:CfdiRelacionado': {
        '@_UUID': input.originalCufe,
      },
    };
  }

  // Emisor.
  comprobanteRoot['cfdi:Emisor'] = {
    '@_Rfc': settings.rfc,
    '@_Nombre': sanitizeName(emisorName),
    '@_RegimenFiscal': settings.regimenFiscalCode,
  };

  // Receptor.
  comprobanteRoot['cfdi:Receptor'] = {
    '@_Rfc': receptor.rfc,
    '@_Nombre': receptor.nombre,
    '@_DomicilioFiscalReceptor': receptor.domicilioFiscal,
    '@_RegimenFiscalReceptor': receptor.regimenFiscal,
    '@_UsoCFDI': receptor.usoCfdi,
    ...(receptor.residenciaFiscal
      ? {
          '@_ResidenciaFiscal': receptor.residenciaFiscal,
          '@_NumRegIdTrib': receptor.numRegIdTrib,
        }
      : {}),
  };

  // Conceptos.
  comprobanteRoot['cfdi:Conceptos'] = {
    'cfdi:Concepto': conceptos,
  };

  // Impuestos agregados.
  if (impuestosAgregados) {
    comprobanteRoot['cfdi:Impuestos'] = impuestosAgregados;
  }

  // -----------------------------------------------------------
  // Build XML con fast-xml-parser.
  // -----------------------------------------------------------
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: false,
    suppressBooleanAttributes: false,
    suppressEmptyNode: false,
  });

  const innerXml = builder.build({
    'cfdi:Comprobante': comprobanteRoot,
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${innerXml}`;

  return {
    uuid,
    xml,
    emisorRfc: settings.rfc,
    receptorRfc: receptor.rfc,
    tipoComprobante,
  };
}

/**
 * Re-formatea un XML CFDI 4.0 para visualización en UI con
 * indentación legible. La fuente queda intacta — esta función es
 * solo para mostrar al operador.
 */
export function prettyPrintCfdi(xml: string): string {
  // fast-xml-parser puede re-format pero requiere parse + build;
  // para evitar el round-trip que puede normalizar atributos de
  // formas inesperadas, hacemos una indentación simple basada en
  // tags. Es defensivo — el XML serializado original no lleva
  // indentación.
  const decl = '<?xml version="1.0" encoding="UTF-8"?>';
  const body = xml.replace(decl, '').trim();

  // Insertar saltos de línea entre tags consecutivos.
  const withBreaks = body.replace(/></g, '>\n<');
  const lines = withBreaks.split('\n');

  let depth = 0;
  const indented: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const isClosing = line.startsWith('</');
    const isSelfClosing = line.endsWith('/>') || /^<[^/!?][^>]*\/>/.test(line);
    if (isClosing) depth = Math.max(0, depth - 1);
    indented.push('  '.repeat(depth) + line);
    if (!isClosing && !isSelfClosing && line.startsWith('<') && !line.startsWith('<?')) {
      // Apertura de elemento.
      depth += 1;
    }
  }

  return `${decl}\n${indented.join('\n')}`;
}

// -------------------------------------------------------------
// Helpers privados.
// -------------------------------------------------------------

interface ResolvedReceptor {
  rfc: string;
  nombre: string;
  domicilioFiscal: string;
  regimenFiscal: string;
  usoCfdi: string;
  residenciaFiscal?: string;
  numRegIdTrib?: string;
}

function buildPublicReceptor(domicilioFiscal: string): ResolvedReceptor {
  return {
    rfc: RECEPTOR_GENERICO.rfcMexicano,
    nombre: RECEPTOR_GENERICO.nombre,
    domicilioFiscal,
    regimenFiscal: REGIMEN_RECEPTOR_PUBLICO_GENERAL,
    usoCfdi: RECEPTOR_GENERICO.usoCfdiPublicoGeneral,
  };
}

function isPostalCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{5}$/.test(value.trim());
}

function toSatCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return RECEPTOR_GENERICO.residenciaFiscalDefault;

  const aliases: Record<string, string> = {
    US: 'USA',
    USA: 'USA',
    'UNITED STATES': 'USA',
    'ESTADOS UNIDOS': 'USA',
    MX: 'MEX',
    MEX: 'MEX',
    MEXICO: 'MEX',
    'MÉXICO': 'MEX',
    CO: 'COL',
    COL: 'COL',
    COLOMBIA: 'COL',
  };
  return aliases[normalized] ?? normalized;
}

function buildReceptor(
  input: FiscalAdapterIssueInput,
  fallbackPostalCode: string
): ResolvedReceptor {
  // Consumidor final: el orchestrator setea taxIdTypeCode='31'
  // (NIT en CO) + taxId='222222222222' cuando customerId es null.
  // Ese mismo path en MX se traduce a XAXX010101000 + UsoCFDI S01.
  const isConsumidorFinal = input.buyer.taxId === '222222222222';
  if (isConsumidorFinal) {
    return buildPublicReceptor(fallbackPostalCode);
  }

  // Receptor extranjero: si país != MX usamos el RFC genérico
  // extranjero + ResidenciaFiscal del país del cliente + UsoCFDI
  // S01 (sin efectos fiscales).
  const isForeign =
    input.buyer.country !== null &&
    input.buyer.country !== undefined &&
    input.buyer.country.toUpperCase() !== 'MX' &&
    input.buyer.country.toUpperCase() !== 'MEX';
  if (isForeign) {
    return {
      rfc: RECEPTOR_GENERICO.rfcExtranjero,
      nombre: sanitizeName(input.buyer.name),
      domicilioFiscal: isPostalCode(input.buyer.city)
        ? input.buyer.city.trim()
        : fallbackPostalCode,
      regimenFiscal: REGIMEN_RECEPTOR_PUBLICO_GENERAL,
      usoCfdi: RECEPTOR_GENERICO.usoCfdiPublicoGeneral,
      residenciaFiscal: toSatCountryCode(input.buyer.country),
      numRegIdTrib: input.buyer.taxId || RECEPTOR_GENERICO.numRegIdTribDefault,
    };
  }

  // El modelo actual de customers no tiene RegimenFiscalReceptor y
  // `city` es texto libre, no código postal. Hasta que ENG-035c
  // capture perfil fiscal MX del receptor, no serializamos esos
  // campos como si fueran datos SAT: caemos a público general.
  return buildPublicReceptor(fallbackPostalCode);
}

interface ConceptoNode {
  '@_ClaveProdServ': string;
  '@_NoIdentificacion'?: string;
  '@_Cantidad': string;
  '@_ClaveUnidad': string;
  '@_Unidad'?: string;
  '@_Descripcion': string;
  '@_ValorUnitario': string;
  '@_Importe': string;
  '@_Descuento'?: string;
  '@_ObjetoImp': string;
  'cfdi:Impuestos'?: {
    'cfdi:Traslados': {
      'cfdi:Traslado': TrasladoNodeAttrs;
    };
  };
}

interface TrasladoNodeAttrs {
  '@_Base': string;
  '@_Impuesto': string;
  '@_TipoFactor': 'Tasa' | 'Exento';
  '@_TasaOCuota'?: string;
  '@_Importe'?: string;
}

function toTrasladoNode(traslado: TrasladoData): TrasladoNodeAttrs {
  return {
    '@_Base': traslado.Base,
    '@_Impuesto': traslado.Impuesto,
    '@_TipoFactor': traslado.TipoFactor,
    ...(traslado.TasaOCuota ? { '@_TasaOCuota': traslado.TasaOCuota } : {}),
    ...(traslado.Importe ? { '@_Importe': traslado.Importe } : {}),
  };
}

function buildConcepto(line: FiscalAdapterLine): ConceptoNode {
  const claveProd = inferProductClaveProdServ({
    name: line.productName,
    categoryName: null,
  });
  const claveUnit = mapUnitToClaveUnidad(line.unitMeasureCode);
  const taxRateDecimal =
    line.taxRate > 1 ? line.taxRate / 100 : Math.max(0, line.taxRate);
  const grossAmount = line.quantity * line.unitPrice;
  const grossAfterDiscount = Math.max(0, grossAmount - line.discountAmount);
  const netAmount =
    taxRateDecimal > 0
      ? grossAfterDiscount / (1 + taxRateDecimal)
      : grossAfterDiscount;
  const netUnitPrice = line.quantity === 0 ? 0 : netAmount / line.quantity;
  const baseGravable = netAmount;
  const traslado = mapTaxRateToTraslado(line.taxRate, line.taxAmount, baseGravable);

  const concepto: ConceptoNode = {
    '@_ClaveProdServ': claveProd.code,
    '@_Cantidad': formatDecimal(line.quantity, 6),
    '@_ClaveUnidad': claveUnit.code,
    '@_Unidad': claveUnit.name,
    '@_Descripcion': sanitizeName(line.productName),
    '@_ValorUnitario': formatDecimal(netUnitPrice, 6),
    '@_Importe': formatDecimal(netAmount, 2),
    // ObjetoImp '02' = Sí objeto del impuesto (gravamen IVA).
    // '01' = No objeto, '03' = Sí objeto pero no obligación de
    // desglose. Default '02' para retail con IVA estándar.
    '@_ObjetoImp': line.taxRate > 0 ? '02' : '01',
  };

  if (line.productSku) {
    concepto['@_NoIdentificacion'] = line.productSku;
  }

  // Solo agregamos cfdi:Impuestos al concepto cuando hay obligación
  // de desglose (ObjetoImp='02'). Conceptos sin gravamen omiten el
  // nodo Impuestos por completo.
  if (concepto['@_ObjetoImp'] === '02') {
    concepto['cfdi:Impuestos'] = {
      'cfdi:Traslados': {
        'cfdi:Traslado': toTrasladoNode(traslado),
      },
    };
  }

  return concepto;
}

interface ImpuestosAgregadosNode {
  '@_TotalImpuestosTrasladados': string;
  'cfdi:Traslados': {
    'cfdi:Traslado': Array<{
      '@_Base': string;
      '@_Impuesto': string;
      '@_TipoFactor': 'Tasa' | 'Exento';
      '@_TasaOCuota'?: string;
      '@_Importe'?: string;
    }>;
  };
}

/**
 * Consolida los Traslados de cada concepto agrupando por (Impuesto,
 * TipoFactor, TasaOCuota). Devuelve `null` cuando ningún concepto
 * tiene gravamen (todos exentos sin obligación de desglose).
 */
function consolidateImpuestos(
  lines: ReadonlyArray<FiscalAdapterLine>
): ImpuestosAgregadosNode | null {
  type Key = string;
  const buckets = new Map<
    Key,
    {
      base: number;
      importe: number;
      impuesto: string;
      tipoFactor: 'Tasa' | 'Exento';
      tasaOCuota?: string;
    }
  >();

  let totalTrasladados = 0;

  for (const line of lines) {
    if (line.taxRate === 0 && line.taxAmount === 0) continue;
    const taxRateDecimal =
      line.taxRate > 1 ? line.taxRate / 100 : Math.max(0, line.taxRate);
    const grossAmount = line.quantity * line.unitPrice;
    const grossAfterDiscount = Math.max(0, grossAmount - line.discountAmount);
    const baseGravable =
      taxRateDecimal > 0
        ? grossAfterDiscount / (1 + taxRateDecimal)
        : grossAfterDiscount;
    const traslado = mapTaxRateToTraslado(line.taxRate, line.taxAmount, baseGravable);
    const key = `${traslado.Impuesto}|${traslado.TipoFactor}|${traslado.TasaOCuota ?? ''}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.base += baseGravable;
      existing.importe += line.taxAmount;
    } else {
      buckets.set(key, {
        base: baseGravable,
        importe: line.taxAmount,
        impuesto: traslado.Impuesto,
        tipoFactor: traslado.TipoFactor,
        tasaOCuota: traslado.TasaOCuota,
      });
    }
    totalTrasladados += line.taxAmount;
  }

  if (buckets.size === 0) return null;

  const traslados = Array.from(buckets.values()).map(bucket => ({
    '@_Base': formatDecimal(bucket.base, 2),
    '@_Impuesto': bucket.impuesto,
    '@_TipoFactor': bucket.tipoFactor,
    ...(bucket.tasaOCuota
      ? {
          '@_TasaOCuota': bucket.tasaOCuota,
          '@_Importe': formatDecimal(bucket.importe, 2),
        }
      : {}),
  }));

  return {
    '@_TotalImpuestosTrasladados': formatDecimal(totalTrasladados, 2),
    'cfdi:Traslados': {
      'cfdi:Traslado': traslados,
    },
  };
}

/**
 * El SAT exige Fecha en formato `YYYY-MM-DDTHH:mm:ss` SIN zona
 * horaria explícita (la zona se asume del LugarExpedicion). El
 * orchestrator nos pasa issueDate `YYYY-MM-DD` + issueTime
 * `HH:mm:ssZ`; armamos el formato SAT.
 */
function formatFechaCfdi(issueDate: string, issueTime: string): string {
  // issueTime puede traer 'Z' al final. El SAT no acepta zona;
  // limpiamos cualquier sufijo de timezone.
  const cleanTime = issueTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  return `${issueDate}T${cleanTime}`;
}

/**
 * Limpia caracteres que el SAT rechaza dentro de atributos XML.
 * Anexo 20 acepta letras, dígitos, espacio, y un set acotado de
 * símbolos. Los caracteres XML reservados (& < > " ') ya los
 * escapa fast-xml-parser; aquí solo normalizamos espacios y
 * recortamos casos extremos.
 */
function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 254);
}
