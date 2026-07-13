/** Physical dimensions shared by DB schema, services, and renderer forms. */
export const UNIT_DIMENSIONS = [
  'count',
  'mass',
  'volume',
  'length',
  'area',
  'time',
  'other',
] as const;

export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];
