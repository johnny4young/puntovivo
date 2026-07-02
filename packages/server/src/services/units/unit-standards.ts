/**
 * Unit-of-measure standards catalog (Auditoría 2026-07 — units foundation).
 *
 * Maps the free-form tenant unit (name + abbreviation) onto a physical
 * `dimension`, a UN/ECE Recommendation 20 `standardCode`, and a
 * `referenceFactor` (the multiplier into the dimension's canonical
 * reference unit). Two jobs:
 *
 * 1. **Fiscal** — LatAm e-invoicing (Colombian DIAN UBL included) requires
 *    a standardized `unitCode` per invoice line. A free-form abbreviation
 *    cannot map to it reliably, so `resolveUnitStandardCode` provides the
 *    code (with a safe piece/`C62` fallback the fiscal adapter can remap).
 * 2. **Dimensional coherence** — `inferUnitDimension` + `dimensionsAreCoherent`
 *    let the app catch nonsensical unit sets (a product measured in both
 *    `kg` and `metre`) and, later, drive dimension-wide conversion.
 *
 * The catalog is keyed by a NORMALIZED abbreviation (upper-cased, accents
 * stripped) so `Kg`, `KG`, and `kg` all resolve. Unknown units resolve to
 * `null` dimension / the fallback code — never an error — so this stays a
 * best-effort enrichment layer over free-form tenant data.
 *
 * Canonical reference units: mass→gram, volume→millilitre, length→metre,
 * area→square-metre, count→unit. `referenceFactor` is "how many reference
 * units in one of me": KGM=1000, GRM=1, LTR=1000, MLT=1, MTR=1, CMT=0.01.
 *
 * @module services/units/unit-standards
 */

import type { UnitDimension } from '../../db/schema/base.js';

export interface UnitStandard {
  dimension: UnitDimension;
  /** UN/ECE Rec 20 code. */
  standardCode: string;
  /** Multiplier from this unit into its dimension's reference unit. */
  referenceFactor: number;
}

/**
 * The fiscal fallback for an un-mapped unit. `C62` (UN/ECE Rec 20 "one")
 * is the conventional piece/each code; a country adapter may remap it (the
 * DIAN catalog, e.g., also accepts `94`). Kept as a named constant so the
 * fiscal builder and the tests reference the same value.
 */
export const DEFAULT_UNIT_STANDARD_CODE = 'C62';

/**
 * Normalize an abbreviation for catalog lookup: upper-case, strip accents
 * and any non-alphanumeric noise. `Ltº` → `LT`, `m³` → `M3`.
 */
export function normalizeUnitKey(abbreviation: string): string {
  // NFKD (compatibility decomposition) folds superscripts and accents to
  // ASCII: `m²` → `M2`, `m³` → `M3`, `Ñ` → `N`. Combining marks and any
  // remaining non-alphanumerics are then stripped.
  return abbreviation
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Catalog of the units a LatAm retail/ferretería/mini-market POS meets in
 * practice, each with its Rec 20 code and reference factor. Aliases (KILO,
 * KGS, …) fold onto the same entry.
 */
const UNIT_CATALOG: Record<string, UnitStandard> = {
  // ---- count (reference: unit) ----
  UND: { dimension: 'count', standardCode: 'C62', referenceFactor: 1 },
  UN: { dimension: 'count', standardCode: 'C62', referenceFactor: 1 },
  UNID: { dimension: 'count', standardCode: 'C62', referenceFactor: 1 },
  UNIDAD: { dimension: 'count', standardCode: 'C62', referenceFactor: 1 },
  EA: { dimension: 'count', standardCode: 'H87', referenceFactor: 1 },
  PZA: { dimension: 'count', standardCode: 'H87', referenceFactor: 1 },
  PIEZA: { dimension: 'count', standardCode: 'H87', referenceFactor: 1 },
  DOC: { dimension: 'count', standardCode: 'DZN', referenceFactor: 12 },
  DOCENA: { dimension: 'count', standardCode: 'DZN', referenceFactor: 12 },
  PAR: { dimension: 'count', standardCode: 'PR', referenceFactor: 2 },
  // Packaging units are count-dimension but their per-product multiple
  // (how many base units in a pack/box) lives on unit_x_product; the
  // referenceFactor here stays 1 because the standard code, not a global
  // factor, is what packaging needs.
  PQTE: { dimension: 'count', standardCode: 'XPK', referenceFactor: 1 },
  PAQ: { dimension: 'count', standardCode: 'XPK', referenceFactor: 1 },
  PAQUETE: { dimension: 'count', standardCode: 'XPK', referenceFactor: 1 },
  CAJA: { dimension: 'count', standardCode: 'XBX', referenceFactor: 1 },
  BOX: { dimension: 'count', standardCode: 'XBX', referenceFactor: 1 },
  BULTO: { dimension: 'count', standardCode: 'XBG', referenceFactor: 1 },
  // ---- mass (reference: gram) ----
  GR: { dimension: 'mass', standardCode: 'GRM', referenceFactor: 1 },
  G: { dimension: 'mass', standardCode: 'GRM', referenceFactor: 1 },
  GRAMO: { dimension: 'mass', standardCode: 'GRM', referenceFactor: 1 },
  KG: { dimension: 'mass', standardCode: 'KGM', referenceFactor: 1000 },
  KGS: { dimension: 'mass', standardCode: 'KGM', referenceFactor: 1000 },
  KILO: { dimension: 'mass', standardCode: 'KGM', referenceFactor: 1000 },
  KILOGRAMO: { dimension: 'mass', standardCode: 'KGM', referenceFactor: 1000 },
  LB: { dimension: 'mass', standardCode: 'LBR', referenceFactor: 453.592 },
  LIBRA: { dimension: 'mass', standardCode: 'LBR', referenceFactor: 453.592 },
  TON: { dimension: 'mass', standardCode: 'TNE', referenceFactor: 1_000_000 },
  // ---- volume (reference: millilitre) ----
  ML: { dimension: 'volume', standardCode: 'MLT', referenceFactor: 1 },
  MLL: { dimension: 'volume', standardCode: 'MLT', referenceFactor: 1 },
  LT: { dimension: 'volume', standardCode: 'LTR', referenceFactor: 1000 },
  L: { dimension: 'volume', standardCode: 'LTR', referenceFactor: 1000 },
  LITRO: { dimension: 'volume', standardCode: 'LTR', referenceFactor: 1000 },
  GAL: { dimension: 'volume', standardCode: 'GLL', referenceFactor: 3785.41 },
  GALON: { dimension: 'volume', standardCode: 'GLL', referenceFactor: 3785.41 },
  // ---- length (reference: metre) ----
  MTR: { dimension: 'length', standardCode: 'MTR', referenceFactor: 1 },
  M: { dimension: 'length', standardCode: 'MTR', referenceFactor: 1 },
  METRO: { dimension: 'length', standardCode: 'MTR', referenceFactor: 1 },
  CM: { dimension: 'length', standardCode: 'CMT', referenceFactor: 0.01 },
  MM: { dimension: 'length', standardCode: 'MMT', referenceFactor: 0.001 },
  // ---- area (reference: square metre) ----
  M2: { dimension: 'area', standardCode: 'MTK', referenceFactor: 1 },
};

/** Look up the full standard for an abbreviation, or null when unknown. */
export function lookupUnitStandard(abbreviation: string): UnitStandard | null {
  return UNIT_CATALOG[normalizeUnitKey(abbreviation)] ?? null;
}

/** Infer just the physical dimension for an abbreviation (null when unknown). */
export function inferUnitDimension(abbreviation: string): UnitDimension | null {
  return lookupUnitStandard(abbreviation)?.dimension ?? null;
}

/**
 * Resolve the fiscal `unitCode` for a unit row. Prefers the explicit
 * `standardCode` stored on the row, then the catalog by abbreviation, then
 * the piece fallback so an invoice line is never emitted without a code.
 */
export function resolveUnitStandardCode(unit: {
  standardCode?: string | null;
  abbreviation: string;
}): string {
  if (unit.standardCode && unit.standardCode.trim().length > 0) {
    return unit.standardCode.trim();
  }
  return lookupUnitStandard(unit.abbreviation)?.standardCode ?? DEFAULT_UNIT_STANDARD_CODE;
}

/**
 * True when every dimension in the set is compatible — i.e. they are all
 * equal, ignoring `null` (unknown) and `count` (packaging levels of a
 * counted good legitimately mix with, say, `unit`). Used to warn when a
 * product's unit assignments span incompatible physical quantities (mass +
 * length), which is almost always a data-entry error.
 */
export function dimensionsAreCoherent(
  dimensions: ReadonlyArray<UnitDimension | null | undefined>
): boolean {
  const meaningful = dimensions.filter(
    (d): d is UnitDimension => d != null && d !== 'count'
  );
  if (meaningful.length <= 1) {
    return true;
  }
  return meaningful.every(d => d === meaningful[0]);
}
