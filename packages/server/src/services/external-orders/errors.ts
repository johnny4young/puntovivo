/** Stable failures without ciphertext, payload, SQLite or provider details. */
import { throwServerError } from '../../lib/errorCodes.js';
export function externalOrderError(
  kind: 'auth' | 'invalid' | 'conflict' | 'missing' | 'key'
): never {
  const code = {
    auth: ['UNAUTHORIZED', 'EXTERNAL_ORDER_AUTH_INVALID', 'External order authentication failed'],
    invalid: ['BAD_REQUEST', 'EXTERNAL_ORDER_INPUT_INVALID', 'External order input is invalid'],
    conflict: [
      'CONFLICT',
      'EXTERNAL_ORDER_STATE_INVALID',
      'External order changed or conflicts with recorded evidence',
    ],
    missing: [
      'NOT_FOUND',
      'EXTERNAL_ORDER_NOT_FOUND',
      'External order or connector is unavailable',
    ],
    key: [
      'PRECONDITION_FAILED',
      'EXTERNAL_ORDER_KEY_UNAVAILABLE',
      'Encrypted connector storage is unavailable',
    ],
  } as const;
  const [trpcCode, errorCode, message] = code[kind];
  throwServerError({ trpcCode, errorCode, message });
}
