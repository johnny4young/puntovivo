/**
 * Tolerance used when reconciling stock quantities that have crossed SQLite
 * or repeated arithmetic boundaries. It is deliberately three orders of
 * magnitude below the smallest 0.001 quantity exposed by Puntovivo's forms,
 * so it absorbs IEEE-754 residue without hiding an operational unit.
 */
export const QUANTITY_EPSILON = 1e-6;
