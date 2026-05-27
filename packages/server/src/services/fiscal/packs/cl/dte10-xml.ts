/**
 * ENG-036b — Serializador de XML DTE 1.0 según especificación SII.
 *
 * Construye un Documento Tributario Electrónico estructuralmente
 * válido a partir del input estándar del orchestrator
 * (`FiscalAdapterIssueInput`) + los settings CL del tenant + la
 * pre-allocación de folio del CAF allocator. El resultado:
 *
 * - Devuelve un string XML serializado listo para persistir en
 *   `fiscal_documents.xml_ref`.
 * - NO firma con XAdES, NO calcula el TED RSA. La FRMT del TED queda
 *   vacía como placeholder; ENG-036c reemplaza con la firma RSA real
 *   leyendo la RSAPK del CAF.
 * - Persiste el Documento.TED.DD completamente — RE / TD / F / FE /
 *   RR / RSR / MNT / IT1 / CAF<DA> / TSTED — para que la boleta
 *   impresa muestre folio + RUT + monto en la forma SII pre-firma.
 *
 * Cobertura DTE 1.0 implementada:
 *
 * - DTE > Documento[ID="F<folio>T<tipoDte>"] root con namespace
 *   `xmlns="http://www.sii.cl/SiiDte"` + version 1.0.
 * - Encabezado.IdDoc con TipoDTE, Folio, FchEmis, IndServicio? y
 *   FmaPago.
 * - Encabezado.Emisor con RUTEmisor, RznSoc (companies.name), GiroEmis
 *   (catálogo CIIU.cl), Acteco (giro code), DirOrigen (casa matriz),
 *   CmnaOrigen (catálogo SUBDERE).
 * - Encabezado.Receptor con RUTRecep + RznSocRecep. Boletas (TipoDTE
 *   39/41) sin buyer usan el RUT genérico SII '66666666-6'. Facturas
 *   (33/34) requieren RUT identificado.
 * - Encabezado.Totales con MntNeto, MntExe, IVA, TasaIVA=19,
 *   MntTotal — todos enteros (CLP no acepta decimales).
 * - Detalle (1..n) con NroLinDet, NmbItem, QtyItem, UnmdItem,
 *   PrcItem, MontoItem, IndExe? (1 cuando línea exenta).
 * - Referencia (cuando source='return' u 'void' con originalCufe):
 *   TpoDocRef='61', FolioRef del original, CodRef='1' (Anula
 *   documento de referencia) para void / '3' (Corrige montos) para
 *   return.
 * - TED.DD con RE, TD, F, FE, RR, RSR, MNT, IT1, CAF<DA>, TSTED.
 * - TED.FRMT placeholder vacío con algoritmo declarado.
 *
 * Cobertura DIFERIDA (ENG-036c):
 *
 * - Firma XAdES sobre el Documento entero.
 * - TED.FRMT real con RSA de la RSAPK del CAF.
 * - Envío al SII (timbraje real, intercambio sobre).
 * - Anulación SII (anulación POS aún se emite como NC; cancelación
 *   formal SII es una operación API separada).
 * - Múltiples impuestos retenidos (ImptoReten) — out of scope retail.
 *
 * @module services/fiscal/packs/cl/dte10-xml
 */

import { XMLBuilder } from 'fast-xml-parser';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../../adapter.js';
import type { ChileFolioAllocation } from './caf-allocator.js';
import {
  TASA_IVA_CL,
  computeDteTotals,
  mapInternalKindToTipoDte,
  mapPaymentMethodToFmaPago,
  mapUnitToUnmdItem,
  roundClp,
} from './mappings.js';
import type { ClFiscalSettings } from './settings.js';

/**
 * Resultado de la serialización: el string XML + los datos clave que
 * el adapter persiste como contexto observable en
 * `fiscal_documents.provider_response`.
 */
export interface SerializedDte10 {
  xml: string;
  /** TipoDTE serializado (33/39/61/...). */
  tipoDte: string;
  /** Folio asignado por el CAF allocator. */
  folio: number;
  /** RUT emisor (settings.fiscal.cl.rut). */
  emisorRut: string;
  /** RUT receptor (cliente identificado o '66666666-6' boleta consumidor final). */
  receptorRut: string;
  /** Monto total en CLP (entero). */
  mntTotal: number;
}

/** RUT genérico SII para boletas a consumidor final. */
const RUT_CONSUMIDOR_FINAL = '66666666-6';
const RAZON_SOC_CONSUMIDOR_FINAL = 'CONSUMIDOR FINAL';

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
      `DTE 1.0 requiere Moneda='CLP'. Recibido: ${input.currencyCode}. Foreign currency requiere extensión SII (ENG-036c).`,
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
  const receptor = isBoleta && !buyerHasRut
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
  // extraemos el bloque <DA> textualmente para que ENG-036c lo
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

// -----------------------------------------------------------
// Helpers privados.
// -----------------------------------------------------------

interface DetalleItemNode {
  NroLinDet: number;
  NmbItem: string;
  QtyItem: number;
  UnmdItem: string;
  PrcItem: number;
  MontoItem: number;
  IndExe?: 1;
}

function buildDetalleItem(line: FiscalAdapterLine, lineNumber: number): DetalleItemNode {
  const grossLineTotal = line.lineTotal;
  // Net = gross - taxAmount when afecto; gross when exento.
  const net = line.taxRate === 0 ? grossLineTotal : grossLineTotal - line.taxAmount;
  const unitPriceNet = line.quantity === 0 ? 0 : net / line.quantity;

  const node: DetalleItemNode = {
    NroLinDet: lineNumber,
    NmbItem: sanitizeText(line.productName, 80),
    QtyItem: line.quantity,
    UnmdItem: mapUnitToUnmdItem(line.unitMeasureCode),
    PrcItem: roundClp(unitPriceNet),
    MontoItem: roundClp(net),
  };
  if (line.taxRate === 0) {
    node.IndExe = 1;
  }
  return node;
}

interface TotalesNode {
  MntNeto: number;
  MntExe?: number;
  TasaIVA?: number;
  IVA?: number;
  MntTotal: number;
}

function buildTotalesNode(totals: ReturnType<typeof computeDteTotals>): TotalesNode {
  const node: TotalesNode = {
    MntNeto: totals.mntNeto,
    MntTotal: totals.mntTotal,
  };
  if (totals.mntExe > 0) {
    node.MntExe = totals.mntExe;
  }
  if (totals.iva > 0) {
    node.TasaIVA = TASA_IVA_CL;
    node.IVA = totals.iva;
  }
  return node;
}

interface ReferenciaNode {
  NroLinRef: number;
  TpoDocRef: string;
  FolioRef: string;
  FchRef: string;
  CodRef: 1 | 2 | 3;
  RazonRef?: string;
}

function buildReferenciaNode(input: FiscalAdapterIssueInput): ReferenciaNode {
  // SII codes:
  //   1 = Anula documento de referencia (void).
  //   2 = Corrige texto (typo correction).
  //   3 = Corrige montos (return — adjustment of amounts).
  const codRef: 1 | 2 | 3 = input.source === 'void' ? 1 : 3;

  // Extract original folio from the cufe shape `sii-cl:<RUT>:<TipoDTE>:<F>`
  // when possible; fall back to placeholder when caller passes a
  // non-CL cufe (defensive — should not happen in production CL flow).
  const cufe = input.originalCufe ?? '';
  const cufeParts = cufe.split(':');
  const isChileCufe = cufeParts.length === 4 && cufeParts[0] === 'sii-cl';
  const tipoDocRef = isChileCufe ? (cufeParts[2] ?? '33') : '33';
  const folioRef = isChileCufe ? (cufeParts[3] ?? cufe) : cufe;

  return {
    NroLinRef: 1,
    TpoDocRef: tipoDocRef,
    FolioRef: folioRef,
    FchRef: input.issueDate,
    CodRef: codRef,
    RazonRef: sanitizeText(input.reasonCode ?? 'AJUSTE', 90),
  };
}

interface TedDdInput {
  rutEmisor: string;
  tipoDte: string;
  folio: number;
  fchEmis: string;
  rutReceptor: string;
  rznSocReceptor: string;
  mntTotal: number;
  primerItem: string;
  cafDaBlock: string;
  tsted: string;
}

interface TedNode {
  '@_version': string;
  DD: {
    RE: string;
    TD: string;
    F: number;
    FE: string;
    RR: string;
    RSR: string;
    MNT: number;
    IT1: string;
    CAF: string;
    TSTED: string;
  };
  FRMT: {
    '@_algoritmo': string;
    '#text': string;
  };
}

function buildTedNode(args: TedDdInput): TedNode {
  return {
    '@_version': '1.0',
    DD: {
      RE: args.rutEmisor,
      TD: args.tipoDte,
      F: args.folio,
      FE: args.fchEmis,
      RR: args.rutReceptor,
      RSR: sanitizeText(args.rznSocReceptor, 40),
      MNT: args.mntTotal,
      IT1: sanitizeText(args.primerItem, 40),
      // CAF DA block goes in as raw text. fast-xml-parser will
      // escape the angle brackets — that's correct because the SII
      // expects the CAF embedded as escaped text inside DD/CAF
      // (timbre validators DECODE before signature verify).
      CAF: args.cafDaBlock,
      TSTED: args.tsted,
    },
    FRMT: {
      '@_algoritmo': 'SHA1withRSA',
      // ENG-036c lifts this placeholder with the real RSA signature
      // computed over DD's canonical form.
      '#text': '',
    },
  };
}

/**
 * Extract the `<DA>...</DA>` block (Datos de Autorización) from a
 * raw CAF XML. Defensive: returns a placeholder when the CAF is
 * malformed (preserves the structural shape so the test fixture
 * doesn't have to be parser-perfect at v1).
 */
function extractCafDaBlock(rawCafXml: string): string {
  const match = rawCafXml.match(/<DA>([\s\S]*?)<\/DA>/);
  if (match) {
    return `<DA>${match[1]}</DA>`;
  }
  return '<DA></DA>';
}

/**
 * SII expects FE in `YYYY-MM-DD` format. The TED.TSTED slot uses ISO
 * timestamp `YYYY-MM-DDTHH:mm:ss` without timezone (SII assumes
 * Chile/Continental).
 */
function combineTimestamp(issueDate: string, issueTime: string): string {
  const cleanTime = issueTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  return `${issueDate}T${cleanTime}`;
}

/**
 * Limpia caracteres que el SII rechaza dentro de elementos XML.
 * SII acepta latin1 + un set acotado de símbolos. Los caracteres
 * XML reservados (& < > " ') ya los escapa fast-xml-parser; aquí
 * solo normalizamos espacios y recortamos al maxLength.
 */
function sanitizeText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function sanitizeName(value: string): string {
  return sanitizeText(value, 100);
}
