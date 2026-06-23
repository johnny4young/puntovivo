/**
 * Pairing-code + device-health tuning constants (ENG-075 Authority Node).
 *
 * @module services/devices/authority/constants
 */

export const PAIRING_CODE_TTL_MINUTES = 10;
export const MAX_PAIRING_CODE_TTL_MINUTES = 60;
export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 8;
export const DEVICE_STALE_AFTER_MS = 15 * 60 * 1000;
