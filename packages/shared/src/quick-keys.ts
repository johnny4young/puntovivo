/** One-touch keys a site shares across its registers. */
export const MAX_SITE_QUICK_KEYS = 8;

/** `open_value` keys sell by amount: the register asks how much and derives the quantity. */
export const SITE_QUICK_KEY_KINDS = ['product', 'open_value'] as const;
export type SiteQuickKeyKind = (typeof SITE_QUICK_KEY_KINDS)[number];

/** Swatch names, not hex values, so each theme decides the shade. */
export const SITE_QUICK_KEY_COLOURS = [
  'orange',
  'yellow',
  'slate',
  'green',
  'lime',
  'sky',
  'violet',
  'red',
] as const;
export type SiteQuickKeyColour = (typeof SITE_QUICK_KEY_COLOURS)[number];
