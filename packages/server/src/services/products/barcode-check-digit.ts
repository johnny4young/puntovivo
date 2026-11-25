import { hasInvalidGs1CheckDigit } from '@puntovivo/shared/gs1';
import { throwServerError } from '../../lib/errorCodes.js';

export { hasInvalidGs1CheckDigit };

/** Reject at write time a GS1 code the till scanner would refuse. */
export function assertGs1CheckDigit(barcode: string | null | undefined): void {
  if (!hasInvalidGs1CheckDigit(barcode)) return;
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'PRODUCT_BARCODE_CHECK_DIGIT_INVALID',
    message: 'The barcode check digit is invalid',
  });
}
