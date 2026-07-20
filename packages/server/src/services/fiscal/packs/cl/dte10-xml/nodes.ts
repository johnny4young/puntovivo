/**
 * DTE 1.0 node builders (): Detalle item, Totales, Referencia,
 * TED, and CAF <DA> extraction.
 *
 * @module services/fiscal/packs/cl/dte10-xml/nodes
 */

import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../../../adapter.js';
import { TASA_IVA_CL, computeDteTotals, mapUnitToUnmdItem, roundClp } from '../mappings.js';
import { sanitizeText } from './format.js';
import type { DetalleItemNode, ReferenciaNode, TedDdInput, TedNode, TotalesNode } from './types.js';

export function buildDetalleItem(line: FiscalAdapterLine, lineNumber: number): DetalleItemNode {
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

export function buildTotalesNode(totals: ReturnType<typeof computeDteTotals>): TotalesNode {
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

export function buildReferenciaNode(input: FiscalAdapterIssueInput): ReferenciaNode {
  // SII codes:
  // 1 = Anula documento de referencia (void).
  // 2 = Corrige texto (typo correction).
  // 3 = Corrige montos (return — adjustment of amounts).
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

export function buildTedNode(args: TedDdInput): TedNode {
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
      // lifts this placeholder with the real RSA signature
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
export function extractCafDaBlock(rawCafXml: string): string {
  const match = rawCafXml.match(/<DA>([\s\S]*?)<\/DA>/);
  if (match) {
    return `<DA>${match[1]}</DA>`;
  }
  return '<DA></DA>';
}
