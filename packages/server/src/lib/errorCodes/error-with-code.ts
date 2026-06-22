/**
 * `ServerErrorWithCode` — the error-cause shape carrying the stable code
 * (ENG-178 split).
 *
 * @module lib/errorCodes/error-with-code
 */
import type { ServerErrorCode } from './registry.js';

/**
 * The tRPC error formatter looks for this shape on `error.cause` to attach
 * the stable code to the JSON response under `data.errorCode`. Exposing it
 * as a class lets `instanceof` checks discriminate it from arbitrary causes.
 */
export class ServerErrorWithCode extends Error {
  readonly errorCode: ServerErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    errorCode: ServerErrorCode,
    message: string,
    details?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.name = 'ServerErrorWithCode';
    this.errorCode = errorCode;
    this.details = details;
  }
}
