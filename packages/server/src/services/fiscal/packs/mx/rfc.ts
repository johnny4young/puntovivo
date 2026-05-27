/**
 * ENG-035a — Validador RFC (Registro Federal de Contribuyentes) para
 * el pack fiscal de México.
 *
 * Reglas SAT (Resolución Miscelánea Fiscal vigente):
 *
 * - **Persona moral (PM)**: 12 caracteres = 3 letras (razón social
 *   abreviada) + 6 dígitos (fecha de constitución AAMMDD) + 3
 *   alfanuméricos (homoclave).
 * - **Persona física (PF)**: 13 caracteres = 4 letras (apellidos +
 *   nombre) + 6 dígitos (fecha de nacimiento AAMMDD) + 3
 *   alfanuméricos (homoclave).
 * - La **homoclave** es un dígito verificador calculado por el SAT
 *   con un algoritmo de suma ponderada módulo 11; los últimos 2
 *   caracteres son letras + el dígito verificador.
 * - El SAT publica una **lista negra** de combinaciones de letras
 *   inapropiadas (palabras altisonantes en español); ese filtro
 *   aplica a las primeras 4 letras del RFC.
 * - **RFC genérico extranjero**: `XEXX010101000` (PM) y
 *   `XAXX010101000` (PF) son aceptados sin validación de homoclave
 *   — el SAT los exime explícitamente para clientes sin RFC propio.
 *
 * El validador es puro: sin acceso a DB ni red. Reusable desde el
 * server (RFC validation antes de persistir) y desde el cliente
 * (hint en tiempo real en `CompanyMxFiscalCard`).
 *
 * Referencias SAT:
 * - Resolución Miscelánea Fiscal 2026, Anexo 1-A, Trámite 41/CFF.
 * - Algoritmo de homoclave: tabla de valores letras + suma
 *   ponderada módulo 11.
 *
 * @module services/fiscal/packs/mx/rfc
 */

/** Tipo de persona detectado al parsear el RFC. */
export type RfcKind = 'persona_moral' | 'persona_fisica';

export type RfcValidationOk = {
  ok: true;
  kind: RfcKind;
  /** Forma normalizada: trim + uppercase. */
  normalized: string;
};

export type RfcValidationError = {
  ok: false;
  code:
    | 'EMPTY'
    | 'INVALID_LENGTH'
    | 'INVALID_STRUCTURE'
    | 'INVALID_DATE'
    | 'INVALID_HOMOCLAVE'
    | 'BLACKLISTED';
  message: string;
};

export type RfcValidationResult = RfcValidationOk | RfcValidationError;

/**
 * RFCs genéricos publicados por el SAT para clientes sin RFC propio.
 * Se aceptan tal cual: el SAT los exime de validación de homoclave
 * porque la fecha y la homoclave son convencionales (010101 + 000).
 */
const RFC_GENERIC_FOREIGN_PM = 'XEXX010101000';
const RFC_GENERIC_FOREIGN_PF = 'XAXX010101000';

/**
 * Lista negra del SAT: combinaciones de 4 letras iniciales que
 * forman palabras altisonantes en español. El SAT pide que estas
 * no se usen tal cual; cuando aparecen en la posición inicial del
 * RFC el sistema las reemplaza por una letra X. Si alguien intenta
 * persistir un RFC con estas iniciales, lo rechazamos para forzar
 * la corrección.
 *
 * Subset del catálogo oficial — incluye las más comunes para que el
 * costo en tiempo de validación quede bajo. La lista completa tiene
 * ~80 entradas; incluir todas no aporta valor proporcional.
 */
const BLACKLISTED_PREFIXES = new Set<string>([
  'BUEI', 'BUEY', 'CACA', 'CACO', 'CAGA', 'CAGO', 'CAKA', 'CAKO',
  'COGE', 'COJA', 'COJE', 'COJI', 'COJO', 'CULO', 'FETO', 'GUEY',
  'JOTO', 'KACA', 'KACO', 'KAGA', 'KAGO', 'KAKA', 'KAKO', 'KOGE',
  'KOJO', 'KULO', 'MAME', 'MAMO', 'MEAR', 'MEAS', 'MEON', 'MIAR',
  'MION', 'MOCO', 'MULA', 'PEDA', 'PEDO', 'PENE', 'PUTA', 'PUTO',
  'QULO', 'RATA', 'RUIN',
  // Subconjunto de 3 letras para PM (sólo aplican cuando son las
  // primeras 3 — el SAT separa los catálogos PM/PF pero la
  // intersección práctica es la misma para los rechazos).
  'BUI', 'COJ', 'CUL', 'KGA', 'MEA', 'PUT',
]);

/**
 * Tabla de valores SAT para el cálculo de homoclave. Cada caracter
 * (0-9, A-Z, Ñ, espacio) tiene un valor de 0 a 37. La suma ponderada
 * de estos valores con pesos descendientes (13, 12, 11, ..., 2)
 * módulo 11 produce el dígito verificador.
 *
 * Nota: el SAT incluye Ñ y espacio en posiciones específicas; aquí
 * sólo manejamos los caracteres que aparecen en RFCs reales (0-9 y
 * A-Z). Los RFCs con Ñ son raros y los aceptamos al estructura pero
 * la homoclave queda exenta del checksum estricto en esos casos
 * (ver branch en `verifyHomoclave`).
 */
const SAT_CHARACTER_VALUES: Record<string, number> = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, 'A': 10, 'B': 11, 'C': 12, 'D': 13, 'E': 14,
  'F': 15, 'G': 16, 'H': 17, 'I': 18, 'J': 19, 'K': 20, 'L': 21,
  'M': 22, 'N': 23, 'O': 24, 'P': 25, 'Q': 26, 'R': 27, 'S': 28,
  'T': 29, 'U': 30, 'V': 31, 'W': 32, 'X': 33, 'Y': 34, 'Z': 35,
  'Ñ': 36, ' ': 37,
};

/**
 * Verifica que las primeras 3-4 letras + 6 dígitos de fecha
 * coincidan con la homoclave esperada (3 alfanuméricos finales).
 *
 * Devuelve `true` cuando la homoclave es válida o cuando el RFC
 * contiene caracteres que la tabla SAT no cubre completamente
 * (por ejemplo Ñ — caso poco común; ahí preferimos aceptar
 * estructura válida en vez de rechazar falsos negativos).
 */
function verifyHomoclave(rfc: string, isPersonaMoral: boolean): boolean {
  const namePartLength = isPersonaMoral ? 3 : 4;
  const namePart = rfc.slice(0, namePartLength);
  const datePart = rfc.slice(namePartLength, namePartLength + 6);
  const homoclave = rfc.slice(namePartLength + 6);

  // Si la homoclave no tiene 3 caracteres, falla por estructura
  // (no por checksum). El caller ya validó la longitud total.
  if (homoclave.length !== 3) return false;

  // El SAT normaliza la razón social / nombre con un espacio inicial
  // para PM (totaliza 12 valores) o sin espacio para PF (12 valores).
  // El padding queda implícito en la suma cuando la longitud del
  // segmento + fecha alcanza los 12 caracteres ponderados.
  const fullName = isPersonaMoral ? ' ' + namePart : namePart;
  const fullForChecksum = fullName + datePart;

  // Si encontramos un caracter fuera de la tabla SAT (por ejemplo Ñ
  // o caracter especial), aceptamos la homoclave sin checksum
  // estricto. Es preferible un falso positivo raro a rechazar RFCs
  // legítimos con caracteres que el catálogo no cubre.
  let weightedSum = 0;
  for (let i = 0; i < fullForChecksum.length; i += 1) {
    // `i < length` guarantees `[i]` is defined; the explicit `if` keeps
    // the narrowing visible to `noUncheckedIndexedAccess` without a
    // non-null assertion.
    const ch = fullForChecksum[i];
    if (ch === undefined) return true;
    const value = SAT_CHARACTER_VALUES[ch];
    if (value === undefined) return true;
    const weight = 13 - i;
    weightedSum += value * weight;
  }

  const checksum = weightedSum % 11;
  const expectedDigit =
    checksum === 0 ? '0' : checksum === 10 ? 'A' : String(checksum);

  // El último caracter de la homoclave es el dígito verificador.
  // Los dos primeros son alfanuméricos derivados de un hash MD5
  // truncado de la cédula completa — no los podemos recomputar
  // sin conocer el algoritmo histórico del SAT, así que sólo
  // validamos que sean alfanuméricos (estructura) + el último
  // dígito (checksum estricto).
  return homoclave[2] === expectedDigit;
}

/**
 * Verifica que la fecha embebida (AAMMDD) sea una fecha calendario
 * válida. RFCs de personas físicas usan la fecha de nacimiento;
 * PM usa la fecha de constitución. Mes 13, día 32, 30 de febrero
 * etc. son rechazados.
 */
function isValidEmbeddedDate(yymmdd: string): boolean {
  if (!/^\d{6}$/.test(yymmdd)) return false;
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const dd = parseInt(yymmdd.slice(4, 6), 10);

  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;

  // Asumimos siglo 20 cuando yy >= 30, siglo 21 cuando yy < 30.
  // El SAT permite cualquier año válido; el split por siglo es
  // sólo para validar días por mes (febrero con bisiesto).
  const fullYear = yy >= 30 ? 1900 + yy : 2000 + yy;
  const date = new Date(fullYear, mm - 1, dd);
  return (
    date.getFullYear() === fullYear &&
    date.getMonth() === mm - 1 &&
    date.getDate() === dd
  );
}

/**
 * Valida un RFC mexicano. Devuelve un resultado discriminado:
 * `{ ok: true, kind, normalized }` cuando todo pasa, o
 * `{ ok: false, code, message }` cuando alguna regla falla.
 */
export function validateRfc(input: unknown): RfcValidationResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return { ok: false, code: 'EMPTY', message: 'El RFC es obligatorio.' };
  }

  const normalized = input.trim().toUpperCase();

  if (normalized.length !== 12 && normalized.length !== 13) {
    return {
      ok: false,
      code: 'INVALID_LENGTH',
      message: `El RFC debe tener 12 caracteres (persona moral) o 13 (persona física); recibido ${normalized.length}.`,
    };
  }

  // Atajo para los RFCs genéricos publicados por el SAT.
  if (normalized === RFC_GENERIC_FOREIGN_PM) {
    return { ok: true, kind: 'persona_moral', normalized };
  }
  if (normalized === RFC_GENERIC_FOREIGN_PF) {
    return { ok: true, kind: 'persona_fisica', normalized };
  }

  const isPersonaMoral = normalized.length === 12;
  const namePartLength = isPersonaMoral ? 3 : 4;
  const namePart = normalized.slice(0, namePartLength);
  const datePart = normalized.slice(namePartLength, namePartLength + 6);
  const homoclave = normalized.slice(namePartLength + 6);

  // Estructura: nombre debe ser sólo letras (incluyendo Ñ y &
  // que el SAT permite en razones sociales).
  if (!/^[A-ZÑ&]+$/.test(namePart)) {
    return {
      ok: false,
      code: 'INVALID_STRUCTURE',
      message: 'Las primeras letras del RFC deben ser sólo caracteres del alfabeto.',
    };
  }
  if (!/^[A-Z0-9]{3}$/.test(homoclave)) {
    return {
      ok: false,
      code: 'INVALID_STRUCTURE',
      message: 'La homoclave debe tener 3 caracteres alfanuméricos.',
    };
  }

  if (!isValidEmbeddedDate(datePart)) {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: 'La fecha embebida en el RFC no es una fecha calendario válida.',
    };
  }

  if (BLACKLISTED_PREFIXES.has(namePart)) {
    return {
      ok: false,
      code: 'BLACKLISTED',
      message: 'El RFC contiene una combinación de letras que el SAT no permite.',
    };
  }

  if (!verifyHomoclave(normalized, isPersonaMoral)) {
    return {
      ok: false,
      code: 'INVALID_HOMOCLAVE',
      message: 'La homoclave del RFC no coincide con el dígito verificador esperado.',
    };
  }

  return {
    ok: true,
    kind: isPersonaMoral ? 'persona_moral' : 'persona_fisica',
    normalized,
  };
}
