/**
 * ENG-035b — Mapeos del modelo interno de Puntovivo a la
 * taxonomía SAT para CFDI 4.0.
 *
 * Cada país traduce el `payment_method` interno y las unidades de
 * medida a su propia taxonomía fiscal. Para México las
 * traducciones usadas en el XML CFDI son:
 *
 * - `payment_method` → c_FormaPago (01 Efectivo, 03 Transferencia,
 *   04 Tarjeta de crédito, 28 Tarjeta de débito, etc.).
 * - `unit code` → c_ClaveUnidad UN/CEFACT (H87 Pieza, KGM
 *   Kilogramo, LTR Litro, etc.).
 * - `tax rate (%)` → nodo cfdi:Traslado con Impuesto='002' (IVA),
 *   TipoFactor='Tasa' / 'Exento', y TasaOCuota formateada con 6
 *   decimales.
 * - `product nombre + categoría` → c_ClaveProdServ (heurística por
 *   substring match contra los `hints` del catálogo curado;
 *   fallback a 01010101 cuando no matches).
 *
 * El módulo es 100% puro — sin dependencias del DB, sin acceso a
 * tenants. Recibe valores escalares y retorna estructuras
 * inmutables. Esto facilita testing exhaustivo + reutilización
 * desde el serializer XML.
 *
 * @module services/fiscal/packs/mx/mappings
 */

import {
  CLAVE_PROD_SERV_CATALOG,
  CLAVE_PROD_SERV_FALLBACK,
  CLAVE_UNIDAD_FALLBACK,
  findClaveProdServ,
  findClaveUnidad,
  findFormaPago,
  type ClaveProdServEntry,
  type ClaveUnidadEntry,
  type FormaPagoEntry,
} from './catalogs/index.js';

/**
 * Mapa entre los métodos de pago internos del POS y los códigos
 * SAT c_FormaPago. Cubrimos los métodos que realmente emite el
 * sistema (`sale_payments.method`):
 *
 * - `cash` → 01 Efectivo
 * - `card` → 04 Tarjeta de crédito (default genérico)
 * - `card_credit` → 04 Tarjeta de crédito
 * - `card_debit` → 28 Tarjeta de débito
 * - `transfer` → 03 Transferencia electrónica de fondos
 * - `check` → 02 Cheque nominativo
 * - `mercado_pago` → 06 Dinero electrónico
 * - `nequi` → 06 Dinero electrónico (CO; cuando un tenant MX usa
 *   el método Nequi por algún flujo cross-border, sigue siendo
 *   dinero electrónico)
 * - `credit` → 99 Por definir (parcialidades requieren complemento
 *   de Pago 2.0; ENG-035c)
 * - `other` → 01 Efectivo (fallback conservador para mantener
 *   PUE válido; el cajero debe corregir el tender real en ENG-035c)
 *
 * Métodos no listados caen al fallback '99 Por definir', que el
 * SAT acepta cuando el comprobante se emite antes de conocer la
 * forma de pago real.
 */
const PAYMENT_METHOD_TO_FORMA_PAGO: Record<string, string> = {
  cash: '01',
  card: '04',
  card_credit: '04',
  card_debit: '28',
  transfer: '03',
  check: '02',
  mercado_pago: '06',
  nequi: '06',
  credit: '99',
  other: '01',
};

/** Código SAT default cuando el método interno no está mapeado. */
export const FORMA_PAGO_FALLBACK = '99';

/**
 * Mapea un método de pago interno al código SAT c_FormaPago. El
 * resultado siempre devuelve una entrada válida del catálogo
 * (incluso si el método interno cae al fallback '99 Por definir').
 *
 * @param internal Código interno del POS (`cash`, `card_debit`, ...).
 * @returns Entry del catálogo c_FormaPago. Nunca lanza.
 */
export function mapPaymentMethodToFormaPago(internal: string): FormaPagoEntry {
  const code = PAYMENT_METHOD_TO_FORMA_PAGO[internal] ?? FORMA_PAGO_FALLBACK;
  // El catálogo siempre contiene el fallback, así que el find nunca
  // devuelve undefined. Defensive cast para mantener el tipo.
  const entry = findFormaPago(code);
  if (!entry) {
    throw new Error(
      `Catálogo SAT c_FormaPago no contiene el código ${code}; revisa formaPago.ts`,
      {
        cause: {
          country: 'MX',
          catalog: 'c_FormaPago',
          missingCode: code,
          internal,
        },
      }
    );
  }
  return entry;
}

/**
 * Mapa entre las unidades de medida internas del catálogo de
 * Puntovivo y los códigos UN/CEFACT que el SAT pide en
 * c_ClaveUnidad.
 *
 * - `unit` / `pza` / `pieza` → H87 Pieza (default retail)
 * - `kg` / `kilogram` → KGM Kilogramo
 * - `g` / `gram` → GRM Gramo
 * - `lt` / `liter` / `litro` → LTR Litro
 * - `ml` / `milliliter` → MLT Mililitro
 * - `m` / `meter` / `metro` → MTR Metro
 * - `cm` → CMT Centímetro
 * - `pkg` / `paquete` → XPK Paquete
 * - `box` / `caja` → XBX Caja
 * - `hr` / `hour` → HUR Hora
 *
 * Unidades no listadas caen a CLAVE_UNIDAD_FALLBACK ('H87' Pieza),
 * que el SAT acepta como genérico para mercancía contable por
 * unidad.
 */
const UNIT_TO_CLAVE_UNIDAD: Record<string, string> = {
  unit: 'H87',
  pza: 'H87',
  pieza: 'H87',
  kg: 'KGM',
  kilogram: 'KGM',
  g: 'GRM',
  gram: 'GRM',
  lt: 'LTR',
  liter: 'LTR',
  litro: 'LTR',
  ml: 'MLT',
  milliliter: 'MLT',
  m: 'MTR',
  meter: 'MTR',
  metro: 'MTR',
  cm: 'CMT',
  pkg: 'XPK',
  paquete: 'XPK',
  box: 'XBX',
  caja: 'XBX',
  hr: 'HUR',
  hour: 'HUR',
};

/**
 * Mapea una unidad de medida interna al c_ClaveUnidad SAT. El
 * resultado siempre devuelve una entrada válida del catálogo;
 * si el unit code no está mapeado cae a 'H87' (Pieza).
 *
 * @param unitCode Código interno del POS (`unit`, `kg`, `lt`, ...).
 * @returns Entry del catálogo c_ClaveUnidad. Nunca lanza.
 */
export function mapUnitToClaveUnidad(unitCode: string): ClaveUnidadEntry {
  const normalized = unitCode.toLowerCase().trim();
  const code = UNIT_TO_CLAVE_UNIDAD[normalized] ?? CLAVE_UNIDAD_FALLBACK;
  const entry = findClaveUnidad(code);
  if (!entry) {
    throw new Error(
      `Catálogo SAT c_ClaveUnidad no contiene el código ${code}; revisa claveUnidad.ts`,
      {
        cause: {
          country: 'MX',
          catalog: 'c_ClaveUnidad',
          missingCode: code,
          unitCode,
        },
      }
    );
  }
  return entry;
}

/**
 * Datos del nodo cfdi:Traslado que el serializer XML necesita por
 * concepto (y agregado al final del comprobante). El SAT exige
 * los 5 campos en el orden Anexo 20.
 */
export interface TrasladoData {
  /** Base gravable formateada con 2 decimales (importe del concepto - descuento). */
  Base: string;
  /** Código SAT del impuesto. '002' = IVA. */
  Impuesto: string;
  /** 'Tasa' cuando hay rate > 0; 'Exento' cuando rate = 0. */
  TipoFactor: 'Tasa' | 'Exento';
  /**
   * Tasa formateada con 6 decimales, p. ej. '0.160000' para 16%
   * IVA, '0.080000' para frontera. Ausente cuando TipoFactor =
   * 'Exento'.
   */
  TasaOCuota?: string;
  /**
   * Importe del impuesto formateado con 2 decimales. Ausente
   * cuando TipoFactor = 'Exento'.
   */
  Importe?: string;
}

/**
 * Construye los datos del nodo cfdi:Traslado para un concepto.
 * Acepta tasas como porcentaje (ej. 16 para 16%) o decimal (ej.
 * 0.16 para 16%) — auto-detecta por valor (>1 lo trata como
 * porcentaje).
 *
 * Cuando taxRate es 0 retorna un Traslado con TipoFactor='Exento'
 * sin TasaOCuota ni Importe (el SAT lo pide así para productos
 * exentos / tasa 0%).
 *
 * @param taxRate Tasa del impuesto (0, 16, o 0.16).
 * @param taxAmount Importe ya calculado por el POS, con 2 decimales.
 * @param base Base gravable (importe del concepto neto de descuento).
 */
export function mapTaxRateToTraslado(
  taxRate: number,
  taxAmount: number,
  base: number
): TrasladoData {
  // Normaliza a decimal: si llega 16 lo divide a 0.16; si llega 0.16 se queda igual.
  const rateDecimal = taxRate > 1 ? taxRate / 100 : taxRate;

  if (rateDecimal === 0) {
    return {
      Base: formatDecimal(base, 2),
      Impuesto: '002',
      TipoFactor: 'Exento',
    };
  }

  return {
    Base: formatDecimal(base, 2),
    Impuesto: '002',
    TipoFactor: 'Tasa',
    TasaOCuota: formatDecimal(rateDecimal, 6),
    Importe: formatDecimal(taxAmount, 2),
  };
}

/**
 * Heurística simple para inferir la c_ClaveProdServ de un producto
 * basándose en su nombre + categoría. Tokeniza nombre + categoría
 * por whitespace + signos de puntuación (case-insensitive,
 * preservando tildes), y recorre el catálogo buscando el primer
 * entry cuyos `hints` matcheen como TOKEN COMPLETO o como
 * substring del nombre completo (la última condición es
 * defensiva — los hints multi-palabra requieren substring match).
 *
 * El match por token completo evita falsos positivos como "vino
 * tinto reserva" matcheando 'res' (que se pretende para 'carne de
 * res') por substring.
 *
 * Si ningún entry matches, retorna el fallback '01010101'.
 *
 * @param ctx Producto con nombre y categoría opcional.
 * @returns Entry del catálogo c_ClaveProdServ. Nunca lanza.
 */
export function inferProductClaveProdServ(ctx: {
  name: string;
  categoryName?: string | null;
}): ClaveProdServEntry {
  const haystack = `${ctx.name} ${ctx.categoryName ?? ''}`.toLowerCase();
  // Tokeniza por whitespace + puntuación pero preservando letras
  // con tildes (categoría: \p{L}\p{N}).
  const tokens = new Set(
    haystack
      .split(/[^\p{L}\p{N}]+/u)
      .map(token => token.trim())
      .filter(token => token.length > 0)
  );

  for (const entry of CLAVE_PROD_SERV_CATALOG) {
    if (entry.hints.length === 0) continue;
    for (const hint of entry.hints) {
      const lowered = hint.toLowerCase();
      // Hints multi-palabra (con espacios) requieren substring
      // match porque no se quedan como token único después del
      // split.
      if (lowered.includes(' ')) {
        if (haystack.includes(lowered)) {
          return entry;
        }
      } else {
        // Hints de una sola palabra: match por token exacto para
        // evitar falsos positivos por substring.
        if (tokens.has(lowered)) {
          return entry;
        }
      }
    }
  }

  // Fallback explícito.
  const fallback = findClaveProdServ(CLAVE_PROD_SERV_FALLBACK);
  if (!fallback) {
    throw new Error(
      `Catálogo SAT c_ClaveProdServ no contiene el fallback ${CLAVE_PROD_SERV_FALLBACK}`,
      {
        cause: {
          country: 'MX',
          catalog: 'c_ClaveProdServ',
          missingCode: CLAVE_PROD_SERV_FALLBACK,
          kind: 'fallback',
        },
      }
    );
  }
  return fallback;
}

/**
 * Formatea un número como string con `precision` decimales fijos.
 * Usa toFixed con clamp de seguridad para evitar overflow en
 * Math.pow(10, n) cuando `precision` es excesivo. El SAT pide:
 *
 * - Cantidad: hasta 6 decimales.
 * - ValorUnitario: hasta 6 decimales.
 * - Importe / SubTotal / Total / Descuento: 2 decimales.
 * - TasaOCuota: 6 decimales fijos para tasas.
 *
 * El método toFixed redondea automáticamente; suficiente para los
 * volúmenes de un POS retail.
 */
export function formatDecimal(value: number, precision: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`formatDecimal: valor no finito recibido (${value})`, {
      cause: {
        country: 'MX',
        helper: 'formatDecimal',
        value,
        precision,
      },
    });
  }
  const safePrecision = Math.max(0, Math.min(precision, 20));
  return value.toFixed(safePrecision);
}
