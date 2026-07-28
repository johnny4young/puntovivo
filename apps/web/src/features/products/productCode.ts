const FALLBACK_STEM = 'PRODUCTO';
const MAX_STEM_LENGTH = 32;
const SUFFIX_LENGTH = 6;

/**
 * Generates a short Code 128-friendly internal product code.
 *
 * The readable stem helps a non-technical operator recognize the product,
 * while the entropy suffix prevents same-name products from colliding across
 * terminals. Entropy is injectable so the formatting contract stays directly
 * testable without mocking browser crypto.
 */
export function createInternalProductCode(
  productName: string,
  entropy: string = globalThis.crypto.randomUUID()
): string {
  const stem =
    productName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_STEM_LENGTH)
      .replace(/-+$/g, '') || FALLBACK_STEM;
  const suffix =
    entropy
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(-SUFFIX_LENGTH)
      .padStart(SUFFIX_LENGTH, '0');

  return `PV-${stem}-${suffix}`;
}
