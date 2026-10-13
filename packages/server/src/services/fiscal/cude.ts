/**
 * CUDE (Código Único de Documento Electrónico) compute helper.
 *
 * CUDE identifies the documento equivalente electrónico (POS ticket,
 * InvoiceTypeCode 20) and every adjustment / credit / debit note. Per the
 * DIAN Anexo Técnico del Documento Equivalente Electrónico v1.0
 * (Resolución 000165/2023, §14.1.3), it is the CUFE layout with the
 * software PIN in place of the resolution technical key:
 *
 * cude = SHA-384(NumFac + FecFac + HorFac + ValFac + '01' + ValImp1 +
 *   '04' + ValImp2 + '03' + ValImp3 + ValTot + NitOFE + NumAdq +
 *   SoftwarePIN + TipoAmbiente)
 *
 * The software PIN is set when the software is registered in the DIAN
 * catalog. DIAN treats it as a restricted value and it never appears in
 * the XML.
 *
 * @module services/fiscal/cude
 */

import { composeDianHashInput, sha384Hex, type DianDocumentHashFields } from './cufe.js';

export interface CudeInput extends DianDocumentHashFields {
  /** PIN of the issuer's software registered with DIAN. */
  softwarePin: string;
}

/** Compose the canonical CUDE input string (the exact hashed bytes). */
export function composeCudeInput(input: CudeInput): string {
  return composeDianHashInput(input, input.softwarePin);
}

/** Compute the 96-character lowercase hex CUDE for the given input. */
export function computeCude(input: CudeInput): string {
  return sha384Hex(composeCudeInput(input));
}
