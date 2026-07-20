/**
 * Serializador de XML CFDI 4.0 según Anexo 20 SAT.
 *
 * Construye un comprobante CFDI 4.0 estructuralmente válido a
 * partir del input estándar del orchestrator
 * (`FiscalAdapterIssueInput`) y los settings MX del tenant. El
 * resultado:
 *
 * - Genera un UUID local con `crypto.randomUUID()` como
 * placeholder. El folio fiscal real (UUID asignado por el SAT
 * al timbrar) llega con  cuando integremos PAC.
 * - Devuelve un string XML serializado listo para persistir en
 * `fiscal_documents.xml_ref`.
 * - NO firma con CSD ni transmite al PAC. El XML queda en estado
 * "draft" representado en el schema con `status='pending'`.
 *
 * Cobertura del Anexo 20 implementada:
 *
 * - cfdi:Comprobante root con todos los atributos requeridos
 * (Version, Serie, Folio, Fecha, FormaPago, NoCertificado vacío,
 * SubTotal, Moneda, Total, TipoDeComprobante, MetodoPago,
 * LugarExpedicion, Exportacion, Sello vacío) + namespaces
 * `xmlns:cfdi` + `xmlns:xsi` + `xsi:schemaLocation`.
 * - cfdi:Emisor con Rfc, Nombre, RegimenFiscal del catálogo SAT.
 * - cfdi:Receptor con Rfc, Nombre, DomicilioFiscalReceptor,
 * RegimenFiscalReceptor, UsoCFDI. Consumidor final usa
 * XAXX010101000 + S01; foreign buyer usa XEXX010101000 + S01.
 * - cfdi:Conceptos > cfdi:Concepto[] con ClaveProdServ,
 * NoIdentificacion (sku), Cantidad, ClaveUnidad, Descripcion,
 * ValorUnitario, Importe, Descuento, ObjetoImp, y nested
 * cfdi:Impuestos > cfdi:Traslados > cfdi:Traslado.
 * - cfdi:Comprobante.cfdi:Impuestos agregado con
 * TotalImpuestosTrasladados + suma de Traslados consolidados.
 * - cfdi:CfdiRelacionados (TipoRelacion='01' Nota crédito) cuando
 * source='return' u source='void' con originalCufe en input.
 *
 * Cobertura DIFERIDA (out of scope para ):
 *
 * - Firmado XAdES con CSD: .
 * - Sello SAT y NoCertificado real: timbrado PAC, .
 * - cfdi:Pagos 2.0 para parcialidades / crédito: .
 * - CartaPorte (transporte de mercancías): fuera de scope LATAM.
 * - ComercioExterior (exportación): fuera de scope retail base.
 * - TipoCambio para foreign currency: el adapter rechaza si
 * currencyCode !== 'MXN' (se modela en  con tabla de
 * tipos de cambio del Banco de México).
 * - IEPS para alcohol y tabaco: el catálogo claveProdServ marca
 * las categorías; el cálculo IEPS lo agrega  con tasas
 * vigentes SAT.
 *
 * @module services/fiscal/packs/mx/cfdi40-xml/serialize
 */

import { randomUUID } from 'node:crypto';
import { XMLBuilder } from 'fast-xml-parser';
import type { FiscalAdapterIssueInput } from '../../../adapter.js';
import { findRegimenFiscal } from '../catalogs/index.js';
import { formatDecimal, mapPaymentMethodToFormaPago } from '../mappings.js';
import type { MxFiscalSettings } from '../settings.js';
import { TIPO_RELACION_NC } from './constants.js';
import { buildConcepto, consolidateImpuestos } from './concepto.js';
import { formatFechaCfdi, sanitizeName } from './format.js';
import { buildReceptor } from './receptor.js';
import type { SerializedCfdi40 } from './types.js';

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
      `CFDI 4.0 requiere Moneda='MXN'. Recibido: ${input.currencyCode}. Foreign currency requiere TipoCambio ().`,
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
    throw new Error(`RegimenFiscal ${settings.regimenFiscalCode} no existe en el catálogo SAT.`, {
      cause: {
        country: 'MX',
        document: 'CFDI40',
        catalog: 'c_RegimenFiscal',
        missingCode: settings.regimenFiscalCode,
        tenantId: input.tenantId,
      },
    });
  }

  // -----------------------------------------------------------
  // Tipo de comprobante: 'I' Ingreso para ventas; 'E' Egreso para
  // returns o voids (Nota de crédito en taxonomía SAT).
  // -----------------------------------------------------------
  const tipoComprobante: 'I' | 'E' = input.source === 'sale' ? 'I' : 'E';

  // -----------------------------------------------------------
  // UUID local (placeholder hasta  PAC timbrado).
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
  const isDeferredPayment = input.source === 'sale' && input.paymentMethod === 'credit';
  const formaPago = mapPaymentMethodToFormaPago(
    isDeferredPayment ? 'credit' : (input.paymentMethod ?? 'cash')
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
