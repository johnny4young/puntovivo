/**
 * Server error-code registry + helpers.
 *
 * The single source of truth for stable, i18n-keyed error codes: the
 * `SERVER_ERROR_CODES` map, the `ServerErrorCode` union, the
 * `ServerErrorWithCode` cause class, and the `throwServerError` helper.
 *
 * decomposed into `./errorCodes/` (codes-a / codes-b registry halves,
 * registry merge, error-with-code, throw). This file stays at the original
 * path as a thin re-export barrel so all ~100 importers resolve unchanged.
 *
 * @module lib/errorCodes
 */
export { SERVER_ERROR_CODES, type ServerErrorCode } from './errorCodes/registry.js';
export { ServerErrorWithCode } from './errorCodes/error-with-code.js';
export { throwServerError } from './errorCodes/throw.js';
