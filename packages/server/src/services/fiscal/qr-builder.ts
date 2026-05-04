/**
 * ENG-058 — Fiscal QR payload builder.
 *
 * Pure module. Given a fiscal document + sale + tenant context, returns
 * the country-specific QR string that the receipt encodes as a 2D
 * barcode. The web client then renders this string into a PNG via
 * dynamic-imported `qrcode` at print time.
 *
 * Three guard layers protect against placeholder CUFE leakage onto a
 * scannable QR:
 *
 *   1. Status gate: returns `null` for any status other than `accepted`
 *      or `sent`. Pending / contingency / rejected / dead_letter never
 *      get a verifiable QR — there is nothing real to scan against.
 *   2. Placeholder gate: returns `null` when `isPlaceholderCufe(cufe)`
 *      is true, even if status disagrees (defense-in-depth).
 *   3. Country gate: unknown countries return `null` — we never invent
 *      a verification URL for an authority we cannot speak to.
 *
 * Per-country branches:
 *
 *   - **CO** (DIAN): `https://catalogo-vpfe[-hab].dian.gov.co/document/searchqr?documentkey=<CUFE>`.
 *   - **MX** (SAT CFDI): `https://verificacfdi.facturaelectronica.sat.gob.mx/?id=<UUID>&re=<RFC_emisor>&rr=<RFC_receptor>&tt=<total padded 17.6>&fe=<sello last 8>`.
 *   - **CL** (SII boleta): TODO(ENG-036b) — returns `null` until the
 *     SII XML DTE serialization + TED computation lands.
 *
 * @module services/fiscal/qr-builder
 */

import type { FiscalDocumentStatus } from '../../db/schema.js';

/** Statuses that produce a scannable QR. */
const QR_ELIGIBLE_STATUSES: ReadonlySet<FiscalDocumentStatus> = new Set([
  'accepted',
  'sent',
]);

/**
 * Detect the placeholder CUFE shape that ENG-057 writes at enqueue
 * (`pending-<nanoid>`). The fiscal worker overwrites this with the
 * adapter-returned real CUFE on `accepted` — so a CUFE that still
 * starts with `pending-` is a definitive signal that the document
 * was never finalized.
 */
export function isPlaceholderCufe(cufe: string | null | undefined): boolean {
  if (!cufe) return true;
  return cufe.startsWith('pending-');
}

export type FiscalEnvironment = 'production' | 'habilitation';

export interface BuildFiscalQrInput {
  /** ISO 3166-1 alpha-2. Falls back to null QR for unknown values. */
  country: string;
  /** Production vs DIAN habilitación / SAT pruebas / SII certification. */
  environment: FiscalEnvironment;
  doc: {
    /** Real CUFE on accepted; `pending-<nanoid>` placeholder otherwise. */
    cufe: string;
    status: FiscalDocumentStatus;
    documentNumber: string;
    /** Receptor RFC for MX, NIT for CO, RUT for CL. */
    buyerTaxId: string;
    totalAmount: number;
    xmlRef: string | null;
    providerResponse: Record<string, unknown> | null;
  };
  /** Issuer identification (NIT, RFC, RUT). */
  tenant: {
    taxId: string;
  };
}

/**
 * Build the QR payload string for a fiscal document. Returns `null`
 * when the document is not in an eligible status, when the CUFE is
 * still a placeholder, or when the country is not yet supported.
 */
export function buildFiscalQrPayload(input: BuildFiscalQrInput): string | null {
  const { country, environment, doc, tenant } = input;

  // Layer 1 + Layer 2: status + placeholder gates apply universally.
  if (!QR_ELIGIBLE_STATUSES.has(doc.status)) {
    return null;
  }
  if (isPlaceholderCufe(doc.cufe)) {
    return null;
  }

  switch (country.toUpperCase()) {
    case 'CO':
      return buildColombiaDianQr(doc.cufe, environment);
    case 'MX':
      return buildMexicoSatQr({
        uuid: doc.cufe,
        rfcEmisor: tenant.taxId,
        rfcReceptor: doc.buyerTaxId,
        total: doc.totalAmount,
        sello: extractSelloDigital(doc.providerResponse),
      });
    case 'CL':
      // TODO(ENG-036b) — Chile SII TED hash. The CL pack ships
      // `validateRut` + RUT catalog (ENG-036a) but the XML DTE
      // serialization that produces the TED is parked. Until then
      // CL receipts render the status badge + document number but
      // no scannable QR. The receipt's status copy still tells the
      // operator + customer the document is not yet stamped.
      return null;
    default:
      return null;
  }
}

function buildColombiaDianQr(cufe: string, env: FiscalEnvironment): string {
  // DIAN Resolución 165/2023: the QR points to the public verification
  // page of the DIAN comprobante catalog. Production uses the bare
  // `catalogo-vpfe` host; habilitación adds the `-hab` suffix.
  const host =
    env === 'habilitation'
      ? 'catalogo-vpfe-hab.dian.gov.co'
      : 'catalogo-vpfe.dian.gov.co';
  return `https://${host}/document/searchqr?documentkey=${encodeURIComponent(cufe)}`;
}

interface MexicoSatQrInput {
  uuid: string;
  rfcEmisor: string;
  rfcReceptor: string;
  total: number;
  sello: string | null;
}

function buildMexicoSatQr(input: MexicoSatQrInput): string {
  // SAT Anexo 20 v4.0 verification URL. Format:
  //   https://verificacfdi.facturaelectronica.sat.gob.mx/?id=<UUID>&re=<RFC_emisor>&rr=<RFC_receptor>&tt=<total>&fe=<sello>
  // - tt is the total padded to 17.6 digits (10 integer, 6 decimal,
  //   leading zeros).
  // - fe is the last 8 chars of selloDigital. Omit when the sello is
  //   unavailable; the verifier still resolves UUID + RFC pair.
  const ttRaw = input.total.toFixed(6); // "100.000000"
  const ttDot = ttRaw.indexOf('.');
  const ttInt = ttRaw.slice(0, ttDot).padStart(10, '0');
  const ttDec = ttRaw.slice(ttDot + 1);
  const tt = `${ttInt}.${ttDec}`; // "0000000100.000000"

  const params = new URLSearchParams();
  params.set('id', input.uuid);
  params.set('re', input.rfcEmisor);
  params.set('rr', input.rfcReceptor);
  params.set('tt', tt);
  if (input.sello && input.sello.length >= 8) {
    params.set('fe', input.sello.slice(-8));
  }

  return `https://verificacfdi.facturaelectronica.sat.gob.mx/?${params.toString()}`;
}

/** Best-effort extractor for the SAT selloDigital from providerResponse. */
function extractSelloDigital(
  providerResponse: Record<string, unknown> | null
): string | null {
  if (!providerResponse) return null;
  const sello = providerResponse.sello ?? providerResponse.selloDigital;
  if (typeof sello === 'string' && sello.length > 0) return sello;
  return null;
}
