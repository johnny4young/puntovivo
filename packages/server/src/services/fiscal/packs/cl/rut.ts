/**
 * ENG-036a — Validador RUT (Rol Único Tributario) para el pack
 * fiscal de Chile.
 *
 * Reglas SII:
 *
 * - **Formato**: `<cuerpo>-<dv>` donde cuerpo son 7 u 8 dígitos y
 *   dv (dígito verificador) es `0-9` o `K`.
 * - **Algoritmo del dígito verificador**: módulo 11 con pesos
 *   cíclicos `{2, 3, 4, 5, 6, 7}` aplicados de derecha a izquierda
 *   sobre el cuerpo. Suma ponderada modulo 11; el resultado se
 *   mapea: r=0 → '0', r=1 → 'K' (porque 11-r=10 no cabe en un
 *   dígito), 2..10 → String(11-r).
 * - **Persona natural vs jurídica**: regla práctica del SII (no
 *   formal) — RUTs con cuerpo ≥ 50.000.000 son personas jurídicas;
 *   los menores son personas naturales. La distinción no bloquea
 *   la emisión, pero la marcamos en el resultado por si la UI
 *   quiere diferenciar.
 * - **RUT genérico extranjero**: `55555555-5` se acepta sin
 *   checksum estricto — el SII lo permite para clientes sin RUT
 *   propio (similar a `XEXX010101000` en MX).
 *
 * El validador es puro: sin acceso a DB ni red. Reusable desde el
 * server (validar antes de persistir) y desde el cliente (hint en
 * tiempo real en `CompanyClFiscalCard`).
 *
 * Referencias SII:
 * - Resolución Exenta SII Nº 1 de 2003, modificada por Nº 80/2014.
 * - Catálogo de RUT pre-asignados: requiere acceso PAC (no shipa
 *   en ENG-036a; queda para ENG-036b si llega a ser necesario).
 *
 * @module services/fiscal/packs/cl/rut
 */

/** Tipo de contribuyente detectado al parsear el RUT. */
export type RutKind = 'natural' | 'juridica';

export type RutValidationOk = {
  ok: true;
  kind: RutKind;
  /** Forma normalizada: trim + uppercase + sin puntos + guión literal. */
  normalized: string;
};

export type RutValidationError = {
  ok: false;
  code: 'EMPTY' | 'INVALID_FORMAT' | 'INVALID_VERIFIER';
  message: string;
};

export type RutValidationResult = RutValidationOk | RutValidationError;

/**
 * RUT genérico extranjero del SII. Se acepta sin recomputar el DV
 * porque es un número convencional para clientes sin RUT propio
 * (similar al XEXX010101000 del SAT mexicano).
 */
const RUT_GENERICO_EXTRANJERO = '55555555-5';

/** Threshold (regla práctica del SII) para distinguir PJ de PF. */
const PERSONA_JURIDICA_THRESHOLD = 50_000_000;

/**
 * Normaliza el RUT a la forma `NNNNNNNN-X`:
 * - Trim + uppercase.
 * - Remueve puntos (`12.345.678-9` → `12345678-9`).
 * - Si el operador escribió sin guión (`12345678X`), inserta guión
 *   antes del último carácter.
 *
 * Esta función nunca lanza; un input que no se pueda normalizar
 * (vacío, muy corto) sale tal cual y la validación posterior lo
 * rechaza con el code adecuado.
 */
function normalizeRut(input: string): string {
  let s = input.trim().toUpperCase().replace(/\./g, '');
  // Si no tiene guión y termina con un carácter de DV plausible,
  // insertamos el guión antes del último carácter.
  if (!s.includes('-') && s.length >= 2 && /[0-9K]$/u.test(s)) {
    s = `${s.slice(0, -1)}-${s.slice(-1)}`;
  }
  return s;
}

/**
 * Calcula el dígito verificador esperado para un cuerpo numérico
 * según el algoritmo del SII.
 */
function computeVerifierDigit(body: number): string {
  const weights = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  let n = body;
  let i = 0;
  while (n > 0) {
    const digit = n % 10;
    sum += digit * weights[i % weights.length];
    n = Math.floor(n / 10);
    i += 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/**
 * Valida un RUT chileno. Devuelve un resultado discriminado
 * `{ ok: true, kind, normalized }` o `{ ok: false, code, message }`.
 */
export function validateRut(input: unknown): RutValidationResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ok: false, code: 'EMPTY', message: 'El RUT es obligatorio.' };
  }

  const normalized = normalizeRut(input);

  // Atajo para el RUT genérico extranjero — el SII lo exime de
  // checksum estricto.
  if (normalized === RUT_GENERICO_EXTRANJERO) {
    return { ok: true, kind: 'juridica', normalized };
  }

  // Estructura: cuerpo-dv. Cuerpo de 1 a 8 dígitos (RUTs reales son
  // 7-8); dv es 0-9 o K.
  const match = normalized.match(/^([0-9]{1,8})-([0-9K])$/u);
  if (!match) {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'El RUT debe tener el formato cuerpo-dígito (p. ej. 12345678-K).',
    };
  }

  const bodyStr = match[1];
  const dv = match[2];
  const body = Number.parseInt(bodyStr, 10);

  if (!Number.isFinite(body) || body < 1) {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'El cuerpo del RUT debe ser un número positivo.',
    };
  }

  const expectedDv = computeVerifierDigit(body);
  if (dv !== expectedDv) {
    return {
      ok: false,
      code: 'INVALID_VERIFIER',
      message: `El dígito verificador no coincide con el esperado (${expectedDv}).`,
    };
  }

  return {
    ok: true,
    kind: body >= PERSONA_JURIDICA_THRESHOLD ? 'juridica' : 'natural',
    normalized,
  };
}
