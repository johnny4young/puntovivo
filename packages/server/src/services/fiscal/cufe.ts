/**
 * ENG-020 — CUFE (Código Único de Factura Electrónica) compute helper.
 *
 * CUFE is the deterministic 96-character hexadecimal hash DIAN requires
 * on every electronic fiscal document. The algorithm is spelled out in
 * Colombia's Resolución DIAN 165/2023 §12.1 and Anexo Técnico 1.9
 * §A.2.5:
 *
 *   cufe = SHA-384(
 *     numFactura ||
 *     fechaFactura ||           // YYYY-MM-DD
 *     horaFactura ||            // HH:mm:ssZZ (ISO offset)
 *     valorSubtotal ||          // two-decimal fixed, dot separator
 *     codigoImpuesto1 ||        // '01' IVA by default
 *     valorImpuesto1 ||
 *     codigoImpuesto2 ||        // '04' INC, '0.00' when absent
 *     valorImpuesto2 ||
 *     codigoImpuesto3 ||        // '03' ICA, '0.00' when absent
 *     valorImpuesto3 ||
 *     valorTotal ||
 *     nitEmisor ||
 *     tipoAdquiriente ||        // '31' for NIT, '13' for CC, …
 *     numeroAdquiriente ||
 *     claveTecnica ||           // DIAN-issued resolution technical key
 *     tipoAmbiente              // '1' production, '2' sandbox
 *   )
 *
 * This module holds the PURE algorithm so the MockAdapter, the
 * architectural-lint tests, and any future FactureAdapter/HkaAdapter
 * can reuse it without duplicating the concatenation format. No
 * side effects, no database access, no `console` output — just a
 * hashing function.
 *
 * @module services/fiscal/cufe
 */

import { createHash } from 'node:crypto';

/**
 * Environment flag DIAN uses to distinguish production ('1') from
 * sandbox ('2') CUFE inputs. The MockAdapter always uses '2'; ENG-021
 * will flip to '1' when the real PT integration ships.
 */
export type FiscalEnvironment = '1' | '2';

export interface CufeInput {
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
  /** Buyer ID type DIAN code (e.g. '31' NIT, '13' CC). */
  buyerIdTypeCode: string;
  /** Buyer ID number — digits only, DV stripped. */
  buyerIdNumber: string;
  /** Resolution technical key DIAN assigned to the issuer. */
  technicalKey: string;
  environment: FiscalEnvironment;
}

function formatAmount(value: number): string {
  // DIAN mandates two-decimal fixed notation with a dot separator.
  // Non-finite values collapse to '0.00' so a malformed input cannot
  // silently produce a hash the receiver cannot verify.
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(2);
}

/**
 * Compose the canonical CUFE input string per DIAN Resolución
 * 165/2023. Exposed separately from `computeCufe` so tests can
 * inspect the exact bytes that went into the hash.
 */
export function composeCufeInput(input: CufeInput): string {
  return (
    input.documentNumber +
    input.issueDate +
    input.issueTime +
    formatAmount(input.subtotal) +
    '01' +
    formatAmount(input.ivaAmount) +
    '04' +
    formatAmount(input.incAmount) +
    '03' +
    formatAmount(input.icaAmount) +
    formatAmount(input.totalAmount) +
    input.issuerNit +
    input.buyerIdTypeCode +
    input.buyerIdNumber +
    input.technicalKey +
    input.environment
  );
}

/**
 * Compute the CUFE hex digest for the given input. Deterministic:
 * same input → same output. Returns a 96-character lowercase hex
 * string (SHA-384 output size is 384 bits = 48 bytes = 96 hex chars).
 */
export function computeCufe(input: CufeInput): string {
  const canonical = composeCufeInput(input);
  return createHash('sha384').update(canonical).digest('hex');
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
