/**
 * Server error-code registry — merge + `ServerErrorCode` union (ENG-178 split).
 *
 * Re-assembles the full `SERVER_ERROR_CODES` map from the two domain halves;
 * the `as const` on each half + on the merge preserves the exact 150-member
 * string-literal union consumed across the server.
 *
 * @module lib/errorCodes/registry
 */
import { SERVER_ERROR_CODES_A } from './codes-a.js';
import { SERVER_ERROR_CODES_B } from './codes-b.js';

export const SERVER_ERROR_CODES = {
  ...SERVER_ERROR_CODES_A,
  ...SERVER_ERROR_CODES_B,
} as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[keyof typeof SERVER_ERROR_CODES];
