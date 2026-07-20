/**
 * Serializador de XML DTE 1.0 según especificación SII.
 *
 * Construye un Documento Tributario Electrónico estructuralmente
 * válido a partir del input estándar del orchestrator
 * (`FiscalAdapterIssueInput`) + los settings CL del tenant + la
 * pre-allocación de folio del CAF allocator. El resultado:
 *
 * - Devuelve un string XML serializado listo para persistir en
 * `fiscal_documents.xml_ref`.
 * - NO firma con XAdES, NO calcula el TED RSA. La FRMT del TED queda
 * vacía como placeholder;  reemplaza con la firma RSA real
 * leyendo la RSAPK del CAF.
 * - Persiste el Documento.TED.DD completamente — RE / TD / F / FE /
 * RR / RSR / MNT / IT1 / CAF<DA> / TSTED — para que la boleta
 * impresa muestre folio + RUT + monto en la forma SII pre-firma.
 *
 * Cobertura DTE 1.0 implementada:
 *
 * - DTE > Documento[ID="F<folio>T<tipoDte>"] root con namespace
 * `xmlns="http://www.sii.cl/SiiDte"` + version 1.0.
 * - Encabezado.IdDoc con TipoDTE, Folio, FchEmis, IndServicio? y
 * FmaPago.
 * - Encabezado.Emisor con RUTEmisor, RznSoc (companies.name), GiroEmis
 * (catálogo CIIU.cl), Acteco (giro code), DirOrigen (casa matriz),
 * CmnaOrigen (catálogo SUBDERE).
 * - Encabezado.Receptor con RUTRecep + RznSocRecep. Boletas (TipoDTE
 * 39/41) sin buyer usan el RUT genérico SII '66666666-6'. Facturas
 * (33/34) requieren RUT identificado.
 * - Encabezado.Totales con MntNeto, MntExe, IVA, TasaIVA=19,
 * MntTotal — todos enteros (CLP no acepta decimales).
 * - Detalle (1..n) con NroLinDet, NmbItem, QtyItem, UnmdItem,
 * PrcItem, MontoItem, IndExe? (1 cuando línea exenta).
 * - Referencia (cuando source='return' u 'void' con originalCufe):
 * TpoDocRef='61', FolioRef del original, CodRef='1' (Anula
 * documento de referencia) para void / '3' (Corrige montos) para
 * return.
 * - TED.DD con RE, TD, F, FE, RR, RSR, MNT, IT1, CAF<DA>, TSTED.
 * - TED.FRMT placeholder vacío con algoritmo declarado.
 *
 * Cobertura DIFERIDA ():
 *
 * - Firma XAdES sobre el Documento entero.
 * - TED.FRMT real con RSA de la RSAPK del CAF.
 * - Envío al SII (timbraje real, intercambio sobre).
 * - Anulación SII (anulación POS aún se emite como NC; cancelación
 * formal SII es una operación API separada).
 * - Múltiples impuestos retenidos (ImptoReten) — out of scope retail.
 *
 * @module services/fiscal/packs/cl/dte10-xml/serialize
 */

import { XMLBuilder } from 'fast-xml-parser';
import type { FiscalAdapterIssueInput } from '../../../adapter.js';
import type { ChileFolioAllocation } from '../caf-allocator.js';
import {
  computeDteTotals,
  mapInternalKindToTipoDte,
  mapPaymentMethodToFmaPago,
} from '../mappings.js';
import type { ClFiscalSettings } from '../settings.js';
import { RAZON_SOC_CONSUMIDOR_FINAL, RUT_CONSUMIDOR_FINAL } from './constants.js';
import { combineTimestamp, sanitizeName, sanitizeText } from './format.js';
import {
  buildDetalleItem,
  buildReferenciaNode,
  buildTedNode,
  buildTotalesNode,
  extractCafDaBlock,
} from './nodes.js';
import type { SerializedDte10 } from './types.js';

/**
 * Serializa un DTE 1.0 estructuralmente válido. Función pura — no
 * toca DB ni red, solo transforma el input en string.
 *
 * @param input Datos del documento del orchestrator.
 * @param settings Settings fiscales CL del tenant.
 * @param emisorName Razón social del emisor (`companies.name`).
 * @param allocation Pre-allocación de folio del CAF allocator.
 * @returns XML serializado + metadatos.
 */
export function serializeDte10(
  input: FiscalAdapterIssueInput,
  settings: ClFiscalSettings,
  emisorName: string,
  allocation: ChileFolioAllocation
): SerializedDte10 {
  // -----------------------------------------------------------
  // Validaciones defensivas.
  // -----------------------------------------------------------
  if (input.lines.length === 0) {
    throw new Error('DTE 1.0 requiere al menos un Detalle; lines vacío.', {
      cause: {
        country: 'CL',
        document: 'DTE10',
        missing: 'lines',
        tenantId: input.tenantId,
      },
    });
  }
  if (input.currencyCode !== 'CLP') {
    throw new Error(
      `DTE 1.0 requiere Moneda='CLP'. Recibido: ${input.currencyCode}. Foreign currency requiere extensión SII ().`,
      {
        cause: {
          country: 'CL',
          document: 'DTE10',
          unsupportedCurrency: input.currencyCode,
          tenantId: input.tenantId,
        },
      }
    );
  }
  if (!settings.rut) {
    throw new Error('DTE 1.0 requiere RUT del emisor en tenant settings.', {
      cause: {
        country: 'CL',
        document: 'DTE10',
        missing: 'settings.rut',
        tenantId: input.tenantId,
      },
    });
  }
  if (!settings.giroCode) {
    throw new Error('DTE 1.0 requiere giro comercial del emisor en tenant settings.', {
      cause: {
        country: 'CL',
        document: 'DTE10',
        missing: 'settings.giroCode',
        tenantId: input.tenantId,
      },
    });
  }
  if (!settings.casaMatriz) {
    throw new Error('DTE 1.0 requiere casa matriz del emisor en tenant settings.', {
      cause: {
        country: 'CL',
        document: 'DTE10',
        missing: 'settings.casaMatriz',
        tenantId: input.tenantId,
      },
    });
  }
  if (!settings.comunaCode) {
    throw new Error('DTE 1.0 requiere comuna del emisor en tenant settings.', {
      cause: {
        country: 'CL',
        document: 'DTE10',
        missing: 'settings.comunaCode',
        tenantId: input.tenantId,
      },
    });
  }

  // -----------------------------------------------------------
  // Decisión de TipoDTE. La allocation viene con tipoDte ya
  // resuelto por el orchestrator (mapInternalKindToTipoDte +
  // CAF-active match), pero aún validamos consistency con buyer.
  // -----------------------------------------------------------
  const buyerHasRut = !!input.buyer.taxId && input.buyer.taxId !== '222222222222';
  const expectedTipoDte = mapInternalKindToTipoDte(input.source, buyerHasRut);
  if (allocation.tipoDte !== expectedTipoDte) {
    // Defensive: orchestrator debería haber pasado el tipoDte
    // correcto. Si no, levantamos para detectar el bug en tests.
    throw new Error(
      `DTE allocation tipoDte=${allocation.tipoDte} no coincide con expected ${expectedTipoDte} (source=${input.source}, buyerHasRut=${buyerHasRut}).`,
      {
        cause: {
          country: 'CL',
          document: 'DTE10',
          tenantId: input.tenantId,
          allocatedTipoDte: allocation.tipoDte,
          expectedTipoDte,
          source: input.source,
          buyerHasRut,
        },
      }
    );
  }

  const isBoleta = allocation.tipoDte === '39' || allocation.tipoDte === '41';
  const isFactura = allocation.tipoDte === '33' || allocation.tipoDte === '34';
  const isNotaCredito = allocation.tipoDte === '61';

  if (isFactura && !buyerHasRut) {
    throw new Error(
      `DTE TipoDTE ${allocation.tipoDte} (factura) requiere receptor con RUT identificado.`,
      {
        cause: {
          country: 'CL',
          document: 'DTE10',
          tenantId: input.tenantId,
          tipoDte: allocation.tipoDte,
          missing: 'buyer.taxId',
        },
      }
    );
  }

  // -----------------------------------------------------------
  // Receptor: cliente identificado vs consumidor final boleta.
  // -----------------------------------------------------------
  const receptor =
    isBoleta && !buyerHasRut
      ? {
          rut: RUT_CONSUMIDOR_FINAL,
          razonSocial: RAZON_SOC_CONSUMIDOR_FINAL,
        }
      : {
          rut: input.buyer.taxId,
          razonSocial: sanitizeName(input.buyer.name),
        };

  // -----------------------------------------------------------
  // Totales SII recomputados desde las líneas (POS guarda precios
  // IVA-incluidos; SII pide MntNeto + IVA separados).
  // -----------------------------------------------------------
  const totals = computeDteTotals(input.lines);

  // -----------------------------------------------------------
  // Encabezado.IdDoc.FmaPago.
  // -----------------------------------------------------------
  const fmaPago = mapPaymentMethodToFmaPago(input.paymentMethod);

  // -----------------------------------------------------------
  // Detalle items.
  // -----------------------------------------------------------
  const detalle = input.lines.map((line, idx) => buildDetalleItem(line, idx + 1));

  // -----------------------------------------------------------
  // Documento JSON intermedio que fast-xml-parser convierte a XML.
  // Atributos prefijados con '@_'; texto libre va directo.
  // -----------------------------------------------------------
  type Node = Record<string, unknown>;

  const documentoBody: Node = {
    '@_ID': `F${allocation.folio}T${allocation.tipoDte}`,
    Encabezado: {
      IdDoc: {
        TipoDTE: allocation.tipoDte,
        Folio: allocation.folio,
        FchEmis: input.issueDate,
        FmaPago: fmaPago,
      },
      Emisor: {
        RUTEmisor: settings.rut,
        RznSoc: sanitizeName(emisorName),
        GiroEmis: settings.giroCode,
        Acteco: settings.giroCode,
        DirOrigen: sanitizeText(settings.casaMatriz, 60),
        CmnaOrigen: settings.comunaCode,
      },
      Receptor: {
        RUTRecep: receptor.rut,
        RznSocRecep: receptor.razonSocial,
      },
      Totales: buildTotalesNode(totals),
    },
    Detalle: detalle,
  };

  // Referencia (NC + voids con originalCufe).
  if (isNotaCredito && input.originalCufe) {
    documentoBody.Referencia = buildReferenciaNode(input);
  }

  // TED — placeholder pre-firma. El allocator nos da el rawCafXml;
  // extraemos el bloque <DA> textualmente para que  lo
  // empate con la RSAPK al firmar.
  documentoBody.TED = buildTedNode({
    rutEmisor: settings.rut,
    tipoDte: allocation.tipoDte,
    folio: allocation.folio,
    fchEmis: input.issueDate,
    rutReceptor: receptor.rut,
    rznSocReceptor: receptor.razonSocial,
    mntTotal: totals.mntTotal,
    primerItem: input.lines[0]?.productName ?? '',
    cafDaBlock: extractCafDaBlock(allocation.rawCafXml),
    tsted: combineTimestamp(input.issueDate, input.issueTime),
  });

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
    DTE: {
      '@_version': '1.0',
      '@_xmlns': 'http://www.sii.cl/SiiDte',
      Documento: documentoBody,
    },
  });

  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n${innerXml}`;

  return {
    xml,
    tipoDte: allocation.tipoDte,
    folio: allocation.folio,
    emisorRut: settings.rut,
    receptorRut: receptor.rut,
    mntTotal: totals.mntTotal,
  };
}

/**
 * Re-formatea un DTE 1.0 con indentación legible. Igual al
 * `prettyPrintCfdi` MX — defensive line-based indentation que evita
 * el round-trip parse + build.
 */
export function prettyPrintDte(xml: string): string {
  const decl = '<?xml version="1.0" encoding="ISO-8859-1"?>';
  const altDecl = '<?xml version="1.0" encoding="UTF-8"?>';
  let body = xml.replace(decl, '').replace(altDecl, '').trim();

  body = body.replace(/></g, '>\n<');
  const lines = body.split('\n');

  let depth = 0;
  const indented: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const isClosing = line.startsWith('</');
    const isSelfClosing = line.endsWith('/>');
    if (isClosing) depth = Math.max(0, depth - 1);
    indented.push('  '.repeat(depth) + line);
    if (!isClosing && !isSelfClosing && line.startsWith('<') && !line.startsWith('<?')) {
      depth += 1;
    }
  }

  // Use the same declaration that arrived (ISO-8859-1 from serializer,
  // UTF-8 if a future caller flipped the encoding).
  const usedDecl = xml.startsWith(decl) ? decl : altDecl;
  return `${usedDecl}\n${indented.join('\n')}`;
}
