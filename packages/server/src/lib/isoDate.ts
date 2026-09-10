/**
 * Strict ISO-8601 calendar parsing.
 *
 * The implementation moved to the shared package so the browser validates
 * lot dates with the same rule the server enforces. This module stays as
 * the server-side entry point; every existing import is unchanged.
 *
 * @module lib/isoDate
 */
export {
  ISO_DATE_ONLY_PATTERN,
  isStrictIsoInstant,
  parseStrictIsoInstant,
} from '@puntovivo/shared/iso-date';
