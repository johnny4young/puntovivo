/**
 * Idempotency keys for the static store QR shown at a transfer checkout.
 *
 * The key identifies one checkout attempt: a re-render, an offline retry or a
 * reopened drawer resolves to the same server-side presentation instead of
 * creating a new row every time. It is keyed by site + destination + rounded
 * amount because a different total is a different charge for the customer and
 * must never reuse the previous presentation.
 *
 * `sessionStorage` keeps the key for the whole checkout without leaking into
 * the next browser session. A successful sale clears it (see
 * `clearPresentationKeys`), so the next sale starts from a fresh attempt.
 */
import { roundMoney } from '@/lib/money';

export const PRESENTATION_STORAGE_PREFIX = 'puntovivo:qr-presentation:';

export interface PresentationKeyInput {
  siteId: string;
  destinationId: string;
  amount: number;
}

// Storage can be unavailable (private mode, quota). Keep the same key in
// memory so retries inside one checkout still dedupe.
const memoryKeys = new Map<string, string>();

function storageKeyFor({ siteId, destinationId, amount }: PresentationKeyInput): string {
  return `${PRESENTATION_STORAGE_PREFIX}${siteId}:${destinationId}:${roundMoney(amount).toFixed(2)}`;
}

function createKey(input: PresentationKeyInput): string {
  // The identity prefix makes two settled amounts (or destinations) distinct
  // even if the platform's random source repeats; the suffix keeps separate
  // abandoned attempts for the same site/destination/amount apart.
  const identity =
    `${input.siteId}:${input.destinationId}:${roundMoney(input.amount).toFixed(2)}`.slice(0, 80);
  const randomUUID = globalThis.crypto?.randomUUID;
  const random = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${identity}:${random}`.slice(0, 128);
}

export function getOrCreatePresentationKey(input: PresentationKeyInput): string {
  const storageKey = storageKeyFor(input);
  try {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored) return stored;
  } catch {
    // Fall back to the in-memory key below.
  }
  const remembered = memoryKeys.get(storageKey);
  if (remembered) return remembered;
  const created = createKey(input);
  try {
    window.sessionStorage.setItem(storageKey, created);
  } catch {
    // The memory fallback still dedupes this checkout.
  }
  memoryKeys.set(storageKey, created);
  return created;
}

/** Forget every stored attempt once a sale has actually been submitted. */
export function clearPresentationKeys(): void {
  memoryKeys.clear();
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(PRESENTATION_STORAGE_PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
