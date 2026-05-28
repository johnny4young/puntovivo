/**
 * ENG-036b — Mapeos del modelo interno de Puntovivo a la taxonomía
 * SII para DTE 1.0.
 *
 * Cada país traduce el `payment_method` interno y otros enums a su
 * propia taxonomía fiscal. Para Chile las traducciones usadas en el
 * XML DTE son:
 *
 * - `payment_method` → IdDoc.FmaPago (1 Contado, 2 Crédito, 3 Sin
 *   costo). El SII no tiene un catálogo tan granular como el SAT —
 *   la decisión clave es contado vs crédito vs gratuito.
 * - `unit code` → Detalle.UnmdItem (texto libre acotado a 4
 *   caracteres por SII validation: 'unidad', 'kg', 'lt', etc.).
 * - `sale source + buyer` → Encabezado.IdDoc.TipoDTE (33 Factura
 *   electrónica si hay RUT receptor; 39 Boleta electrónica si no;
 *   61 Nota crédito para returns/voids).
 * - `tax rate` → Encabezado.Totales.TasaIVA (hardcoded 19% en v1
 *   per regla SII vigente; future-proof para futuros cambios via
 *   tenant-locale settings en ENG-036c).
 *
 * El módulo es 100% puro — sin dependencias del DB, sin acceso a
 * tenants. Recibe valores escalares y retorna estructuras
 * inmutables. Esto facilita testing exhaustivo + reutilización
 * desde el serializer XML.
 *
 * @module services/fiscal/packs/cl/mappings
 */

import type { FiscalDocumentSource } from '../../../../db/schema.js';

/**
 * Tasa IVA Chile vigente desde la reforma tributaria 2014. El SII
 * permite tasa diferenciada solo para casos muy puntuales (frontera,
 * combustibles); los retailers normales emiten al 19%. Cuando ENG-036c
 * agregue tenant-locale tax rate settings esto se vuelve un default.
 */
export const TASA_IVA_CL = 19;

/** SII forma de pago. 1 = Contado, 2 = Crédito, 3 = Sin costo. */
export type FmaPago = 1 | 2 | 3;

/**
 * Mapa entre los métodos de pago internos del POS y la FmaPago SII.
 * El SII solo distingue contado vs crédito vs gratuito — no tiene
 * granularidad efectivo/tarjeta/transferencia (el detalle vive en
 * `Pagos`, opcional, no aplicable a boletas).
 *
 * - `cash` / `card` / `card_credit` / `card_debit` / `transfer` /
 *   `check` / `mercado_pago` / `nequi` / `other` → 1 (Contado)
 * - `credit` → 2 (Crédito) — pago diferido a plazo cliente.
 *
 * Cuando el SII pide `Sin costo` (3) es para muestras gratis u
 * obsequios; ese flow es out-of-scope para v1 retail.
 */
const PAYMENT_METHOD_TO_FMA_PAGO: Record<string, FmaPago> = {
  cash: 1,
  card: 1,
  card_credit: 1,
  card_debit: 1,
  transfer: 1,
  check: 1,
  mercado_pago: 1,
  nequi: 1,
  other: 1,
  credit: 2,
};

/**
 * Mapea un método de pago interno a la FmaPago SII. El default es
 * 1 (Contado) cuando el método no está mapeado — coherente con un
 * POS retail.
 */
export function mapPaymentMethodToFmaPago(internal: string | undefined): FmaPago {
  if (!internal) return 1;
  return PAYMENT_METHOD_TO_FMA_PAGO[internal] ?? 1;
}

/**
 * Mapa entre las unidades de medida internas del catálogo de
 * Puntovivo y los strings que el SII acepta en `Detalle.UnmdItem`.
 * El SII NO tiene un catálogo cerrado como el SAT/UN-CEFACT;
 * acepta texto libre con un acotado de 4 caracteres en algunas
 * implementaciones de timbraje.
 *
 * Convención: minúsculas, sin tildes, abreviado.
 *
 * - `unit` / `pza` / `pieza` → 'un' (unidad)
 * - `kg` / `kilogram` → 'kg'
 * - `g` / `gram` → 'gr'
 * - `lt` / `liter` / `litro` → 'lt'
 * - `ml` / `milliliter` → 'ml'
 * - `m` / `meter` / `metro` → 'm'
 * - `cm` → 'cm'
 * - `pkg` / `paquete` → 'pq'
 * - `box` / `caja` → 'cj'
 * - `hr` / `hour` → 'hr'
 *
 * Unidades no listadas caen al fallback 'un'.
 */
const UNIT_TO_UNMD_ITEM: Record<string, string> = {
  unit: 'un',
  pza: 'un',
  pieza: 'un',
  kg: 'kg',
  kilogram: 'kg',
  g: 'gr',
  gram: 'gr',
  lt: 'lt',
  liter: 'lt',
  litro: 'lt',
  ml: 'ml',
  milliliter: 'ml',
  m: 'm',
  meter: 'm',
  metro: 'm',
  cm: 'cm',
  pkg: 'pq',
  paquete: 'pq',
  box: 'cj',
  caja: 'cj',
  hr: 'hr',
  hour: 'hr',
};

/** Fallback SII unit when the internal code is unmapped. */
export const UNMD_ITEM_FALLBACK = 'un';

export function mapUnitToUnmdItem(unitCode: string): string {
  const normalized = unitCode.toLowerCase().trim();
  return UNIT_TO_UNMD_ITEM[normalized] ?? UNMD_ITEM_FALLBACK;
}

/**
 * Decide el TipoDTE SII a partir del source del orchestrator + si
 * el receptor tiene RUT identificado.
 *
 * - `sale` + receptor con RUT → 33 (Factura electrónica afecta).
 * - `sale` sin receptor identificado → 39 (Boleta electrónica
 *   afecta — consumidor final).
 * - `return` → 61 (Nota de crédito electrónica) referenciando el
 *   DTE original.
 * - `void` → 61 (Nota de crédito electrónica anulando el DTE
 *   original; el SII trata anulaciones POS como NC con código de
 *   referencia '1' = Anula documento de referencia).
 */
export function mapInternalKindToTipoDte(
  source: FiscalDocumentSource,
  buyerHasRut: boolean
): string {
  if (source === 'return' || source === 'void') {
    return '61';
  }
  // source === 'sale'.
  return buyerHasRut ? '33' : '39';
}

/**
 * Redondeo CLP a entero (sin decimales) para la serialización del DTE.
 *
 * Invariantes:
 * - Redondea a entero con Math.round() (0.5 hacia arriba; el SII no
 *   especifica regla, este es el default de JS). Es la regla de redondeo
 *   del SII: el organismo rechaza fracciones en la mayoría de los nodos
 *   numéricos del DTE, así que los montos viajan como pesos enteros.
 * - Es EXCLUSIVO de la serialización XML del DTE (computeDteTotals y
 *   dte10-xml.ts). NO toca la ruta transaccional de dinero: las columnas
 *   de dinero del POS siguen guardándose con dos decimales vía roundMoney
 *   (lib/money.ts), país-agnóstico. El redondeo a entero por país (peso
 *   chileno) vive solo aquí, en el serializador, no en completeSale.
 * - Lanza Error con cause en valor no finito — un total mal calculado
 *   corriente arriba aborta la emisión en vez de escribir un DTE inválido.
 *
 * Precondición: value es finito. Postcondición: devuelve el entero CLP
 * listo para el nodo numérico del DTE.
 */
export function roundClp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`roundClp: valor no finito recibido (${value})`, {
      cause: {
        country: 'CL',
        helper: 'roundClp',
        value,
      },
    });
  }
  return Math.round(value);
}

/**
 * Calcula los totales SII a partir de las líneas:
 *
 * - MntNeto: suma de líneas afectas (taxRate > 0) sin IVA.
 * - MntExe: suma de líneas exentas (taxRate === 0).
 * - IVA: redondeo CLP de MntNeto * (TASA_IVA_CL / 100).
 * - MntTotal: MntNeto + MntExe + IVA.
 *
 * El POS de Puntovivo guarda precios IVA-INCLUIDOS por convención;
 * el orchestrator pasa subtotal/taxAmount/total ya separados, así
 * que esta función opera sobre las líneas crudas para reconstruir
 * los buckets afecto/exento.
 */
export interface DteTotals {
  mntNeto: number;
  mntExe: number;
  iva: number;
  mntTotal: number;
}

export function computeDteTotals(
  lines: ReadonlyArray<{ taxRate: number; lineTotal: number; taxAmount: number }>
): DteTotals {
  let mntNetoRaw = 0;
  let mntExe = 0;
  let iva = 0;

  for (const line of lines) {
    // POS line.lineTotal includes tax; SII separates net + IVA.
    const netLine = line.lineTotal - line.taxAmount;
    if (line.taxRate === 0) {
      mntExe += netLine;
    } else {
      mntNetoRaw += netLine;
      iva += line.taxAmount;
    }
  }

  const mntNeto = roundClp(mntNetoRaw);
  const mntExeR = roundClp(mntExe);
  const ivaR = roundClp(iva);
  const mntTotal = mntNeto + mntExeR + ivaR;

  return {
    mntNeto,
    mntExe: mntExeR,
    iva: ivaR,
    mntTotal,
  };
}
