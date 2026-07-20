/**
 * Staff PIN policy — .
 *
 * PINs are intentionally fixed at six digits: short enough for a shared POS,
 * but paired with Argon2id storage and persistent failure throttles because the
 * credential space is still low entropy. A domain prefix prevents a copied
 * password hash from being accepted as a PIN hash (or vice versa).
 */

import { hashPasswordSecurely, verifyPasswordSecurely } from './passwords.js';

export const STAFF_PIN_LENGTH = 6;
export const STAFF_PIN_PATTERN = /^\d{6}$/;

const STAFF_PIN_DOMAIN = 'puntovivo:staff-pin:v1:';

function credential(pin: string): string {
  return `${STAFF_PIN_DOMAIN}${pin}`;
}

export function isValidStaffPin(pin: string): boolean {
  return STAFF_PIN_PATTERN.test(pin);
}

export async function hashStaffPin(pin: string): Promise<string> {
  if (!isValidStaffPin(pin)) {
    throw new Error(`Staff PIN must contain exactly ${STAFF_PIN_LENGTH} digits`);
  }
  return hashPasswordSecurely(credential(pin));
}

export function verifyStaffPin(storedHash: string, pin: string): Promise<boolean> {
  if (!isValidStaffPin(pin)) {
    return Promise.resolve(false);
  }
  return verifyPasswordSecurely(storedHash, credential(pin));
}

let dummyHashPromise: Promise<string> | null = null;

/** Timing equalizer for unavailable/unenrolled switch targets. */
export function getDummyStaffPinHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashStaffPin('000000');
  }
  return dummyHashPromise;
}

export async function warmUpStaffPinSecurity(): Promise<void> {
  await getDummyStaffPinHash();
}
