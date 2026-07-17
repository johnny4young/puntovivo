/**
 * A-33 — Validador del NIT (Número de Identificación Tributaria) y su
 * dígito de verificación (DV) para el pack fiscal de Colombia.
 *
 * El NIT que la DIAN asigna termina en un dígito de verificación calculado
 * con una suma ponderada módulo 11. Guardar un NIT sin verificar ese dígito
 * es la fuente #1 de facturas rechazadas por la DIAN al momento de emitir,
 * y hoy el pack CO lo persistía como texto libre. Este validador lo cierra:
 * el server rechaza un NIT con DV incorrecto antes de persistir, y la card
 * de configuración muestra el DV correcto mientras el admin escribe.
 *
 * Algoritmo DIAN (pesos oficiales, aplicados a los dígitos de derecha a
 * izquierda):
 *
 *   pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
 *   suma  = Σ (dígito_i × peso_i)     // i desde la derecha
 *   resto = suma mod 11
 *   DV    = resto > 1 ? 11 - resto : resto
 *
 * El validador es puro (sin DB ni red) para reusarlo desde el server
 * (antes de persistir) y desde el cliente (hint en vivo en
 * `CompanyCoFiscalCard`), igual que `validateRfc` en el pack MX.
 *
 * Referencias:
 * - DIAN, Anexo técnico de facturación electrónica 1.9 (cálculo del DV).
 * - Estatuto Tributario, art. 555-1 (NIT).
 *
 * @module services/fiscal/packs/co/nit
 */

/** Pesos oficiales DIAN, de la posición menos significativa a la más. */
const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** El NIT base (sin DV) admite hasta 15 dígitos según el anexo DIAN. */
const MAX_NIT_DIGITS = 15;

/**
 * Resultado de validar un NIT (con o sin DV adjunto). Los campos:
 * - `valid`: el NIT base es sano Y (si venía DV) el DV coincide.
 * - `nit`: solo los dígitos base, sin puntos ni DV.
 * - `verificationDigit`: el DV correcto computado para ese NIT base.
 * - `providedDigit`: el DV que traía la entrada (null si no traía).
 * - `reason`: por qué falló, para mapear a un mensaje del usuario.
 */
export interface NitValidationResult {
  valid: boolean;
  nit: string;
  verificationDigit: number | null;
  providedDigit: number | null;
  reason: 'ok' | 'empty' | 'non_numeric' | 'too_long' | 'dv_mismatch';
}

/**
 * Compute the DIAN verification digit for a NIT base (digits only, no DV).
 * Assumes `nitDigits` is already stripped to digits — callers use
 * {@link validateNit} for the full parse.
 */
export function computeNitVerificationDigit(nitDigits: string): number {
  let sum = 0;
  // Walk the digits right-to-left, pairing each with the weight at that
  // position. A NIT shorter than the weight vector simply uses the first
  // few weights.
  for (let i = 0; i < nitDigits.length; i += 1) {
    const digit = nitDigits.charCodeAt(nitDigits.length - 1 - i) - 48; // '0' === 48
    sum += digit * DV_WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

/**
 * Parse and validate a NIT that may arrive as `900373115`, `900373115-3`,
 * or `900.373.115-3`. Separators (dots, spaces) are stripped; a trailing
 * `-D` is read as the provided DV. When a DV is present it must match the
 * computed one; when absent, the NIT base is validated for shape only and
 * the correct DV is returned so the UI can show it.
 */
export function validateNit(input: string): NitValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, nit: '', verificationDigit: null, providedDigit: null, reason: 'empty' };
  }

  // Split an explicit `-D` DV suffix before stripping separators, so a NIT
  // written with dot-grouping and a dashed DV parses cleanly.
  const dashIndex = trimmed.lastIndexOf('-');
  let basePart = trimmed;
  let providedDigit: number | null = null;
  if (dashIndex !== -1) {
    const dvCandidate = trimmed.slice(dashIndex + 1).trim();
    // Only treat it as a DV if it is a single digit; otherwise the dash is
    // part of a malformed input and we let the numeric check reject it.
    if (/^\d$/.test(dvCandidate)) {
      providedDigit = Number(dvCandidate);
      basePart = trimmed.slice(0, dashIndex);
    }
  }

  const nit = basePart.replace(/[.\s]/g, '');
  if (!/^\d+$/.test(nit)) {
    return {
      valid: false,
      nit,
      verificationDigit: null,
      providedDigit,
      reason: 'non_numeric',
    };
  }
  if (nit.length > MAX_NIT_DIGITS) {
    return {
      valid: false,
      nit,
      verificationDigit: null,
      providedDigit,
      reason: 'too_long',
    };
  }

  const verificationDigit = computeNitVerificationDigit(nit);
  if (providedDigit !== null && providedDigit !== verificationDigit) {
    return { valid: false, nit, verificationDigit, providedDigit, reason: 'dv_mismatch' };
  }

  return { valid: true, nit, verificationDigit, providedDigit, reason: 'ok' };
}
