/**
 * CUFE (Código Único de Factura Electrónica) compute helper, plus the
 * DIAN hash layout shared with the CUDE (`./cude.ts`).
 *
 * CUFE identifies an electronic sales invoice (FEV). It is the
 * deterministic 96-character hexadecimal SHA-384 digest defined by the
 * DIAN UBL 2.1 Anexo Técnico:
 *
 * cufe = SHA-384(
 * NumFac ||
 * FecFac ||                 // YYYY-MM-DD
 * HorFac ||                 // HH:mm:ssZZ (ISO offset)
 * ValFac ||                 // two-decimal fixed, dot separator
 * '01' || ValImp1 ||        // IVA
 * '04' || ValImp2 ||        // INC, '0.00' when absent
 * '03' || ValImp3 ||        // ICA, '0.00' when absent
 * ValTot ||
 * NitOFE ||                 // issuer NIT, digits only, no DV
 * NumAdq ||                 // buyer ID, digits only, no DV
 * ClTec ||                  // resolution technical key
 * TipoAmbiente              // '1' production, '2' test
 * )
 *
 * The CUDE uses the same layout with the software PIN in place of ClTec.
 * The buyer ID type is NOT part of either hash.
 *
 * Pure: no side effects, no database access, no `console` output.
 *
 * @module services/fiscal/cufe
 */

import { createHash } from 'node:crypto';

/**
 * Environment flag DIAN uses to distinguish production ('1') from
 * test ('2') hash inputs. The MockAdapter defaults to '2'.
 */
export type FiscalEnvironment = '1' | '2';

/** Document fields shared by the CUFE and CUDE layouts. */
export interface DianDocumentHashFields {
  /** Consecutive document number — the full string with prefix (e.g. "SETP9900000001"). */
  documentNumber: string;
  /** ISO date (YYYY-MM-DD) in the issuer's timezone. */
  issueDate: string;
  /** ISO time with offset (HH:mm:ssZZ) in the issuer's timezone. */
  issueTime: string;
  subtotal: number;
  /** IVA (tax code '01') amount. Pass 0 when absent. */
  ivaAmount: number;
  /** INC (tax code '04') amount. Pass 0 when absent. */
  incAmount: number;
  /** ICA (tax code '03') amount. Pass 0 when absent. */
  icaAmount: number;
  totalAmount: number;
  /** Issuer NIT — digits only, DV stripped. */
  issuerNit: string;
  /** Buyer ID number — digits only, DV stripped. */
  buyerIdNumber: string;
  environment: FiscalEnvironment;
}

export interface CufeInput extends DianDocumentHashFields {
  /** Resolution technical key DIAN assigned to the numbering range. */
  technicalKey: string;
}

function formatAmount(value: number): string {
  // DIAN mandates two-decimal fixed notation with a dot separator.
  // Non-finite values collapse to '0.00' so a malformed input cannot
  // silently produce a hash the receiver cannot verify.
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
}

/**
 * Concatenate the DIAN hash layout. `securityCode` is the resolution
 * technical key for a CUFE and the software PIN for a CUDE.
 */
export function composeDianHashInput(fields: DianDocumentHashFields, securityCode: string): string {
  return (
    fields.documentNumber +
    fields.issueDate +
    fields.issueTime +
    formatAmount(fields.subtotal) +
    '01' +
    formatAmount(fields.ivaAmount) +
    '04' +
    formatAmount(fields.incAmount) +
    '03' +
    formatAmount(fields.icaAmount) +
    formatAmount(fields.totalAmount) +
    fields.issuerNit +
    fields.buyerIdNumber +
    securityCode +
    fields.environment
  );
}

export function sha384Hex(canonical: string): string {
  return createHash('sha384').update(canonical).digest('hex');
}

/**
 * Compose the canonical CUFE input string. Exposed separately from
 * `computeCufe` so tests can inspect the exact bytes that went into the hash.
 */
export function composeCufeInput(input: CufeInput): string {
  return composeDianHashInput(input, input.technicalKey);
}

/**
 * Compute the CUFE hex digest for the given input. Deterministic:
 * same input → same output. Returns a 96-character lowercase hex
 * string (SHA-384 output size is 384 bits = 48 bytes = 96 hex chars).
 */
export function computeCufe(input: CufeInput): string {
  return sha384Hex(composeCufeInput(input));
}

/**
 * Convenience constant: the fixed buyer identity DIAN prescribes for
 * point-of-sale transactions with no identified customer ("consumidor
 * final"). Emitters use NIT 222222222222 with DIAN ID type code 31,
 * and the buyer name is rendered as the Spanish string "Consumidor
 * final" in the fiscal document XML.
 */
export const CONSUMIDOR_FINAL = {
  taxId: '222222222222',
  taxIdTypeCode: '31',
  name: 'Consumidor final',
} as const;
