/**
 * Pure barcode parser unit tests.
 *
 * Locks the EAN-13/EAN-8/UPC-A checksum behavior, GS1 prefix-2
 * weight/price decoding, and the discriminated-union shape the
 * `products.lookupByBarcode` procedure relies on. The parser is a
 * pure module; tests stay synchronous + I/O-free.
 */

import { describe, expect, it } from 'vitest';
import {
  parseGs1WeightOrPrice,
  parseScan,
  validateEan13Checksum,
  validateEan8Checksum,
  validateUpcAChecksum,
} from '../services/peripherals/barcode/parser.js';

describe('validateEan13Checksum', () => {
  it('accepts a known-valid EAN-13', () => {
    // ISBN-13 example with verified checksum.
    expect(validateEan13Checksum('9788471800213')).toBe(true);
  });

  it('rejects an EAN-13 with a corrupted check digit', () => {
    expect(validateEan13Checksum('9788471800217')).toBe(false);
  });

  it('rejects non-digit input', () => {
    expect(validateEan13Checksum('978-4718002A3')).toBe(false);
  });

  it('rejects shorter input', () => {
    expect(validateEan13Checksum('978847180021')).toBe(false);
  });
});

describe('validateEan8Checksum', () => {
  it('accepts a known-valid EAN-8', () => {
    expect(validateEan8Checksum('73513537')).toBe(true);
  });

  it('rejects an EAN-8 with a corrupted check digit', () => {
    expect(validateEan8Checksum('73513531')).toBe(false);
  });

  it('rejects non-8-digit input', () => {
    expect(validateEan8Checksum('1234567')).toBe(false);
  });
});

describe('validateUpcAChecksum', () => {
  it('accepts a known-valid UPC-A', () => {
    // Coca-Cola Classic 12-oz can canonical example.
    expect(validateUpcAChecksum('042100005264')).toBe(true);
  });

  it('rejects a UPC-A with a corrupted check digit', () => {
    expect(validateUpcAChecksum('042100005269')).toBe(false);
  });
});

describe('parseGs1WeightOrPrice', () => {
  it('decodes a weight-embedded label (role digit even)', () => {
    // 2 0 12345 01234 9 — sku 12345, 1234 grams, valid EAN-13 checksum
    const result = parseGs1WeightOrPrice({ code: '2012345012349' });
    expect(result).toEqual({
      kind: 'gs1-weight',
      sku: '12345',
      weightKg: 1.234,
    });
  });

  it('decodes a price-embedded label (role digit odd)', () => {
    // 2 1 12345 00199 9 — sku 12345, 199 cents = $1.99, valid EAN-13
    const result = parseGs1WeightOrPrice({ code: '2112345001999' });
    expect(result).toEqual({
      kind: 'gs1-price',
      sku: '12345',
      priceMajor: 1.99,
    });
  });

  it('returns null when the leading digit is not 2', () => {
    expect(parseGs1WeightOrPrice({ code: '9788471800213' })).toBeNull();
  });

  it('returns null when scheme is none', () => {
    expect(parseGs1WeightOrPrice({ code: '2012345012349', scheme: 'none' })).toBeNull();
  });

  it('decodes under per-country schemes (currently piggyback on generic)', () => {
    expect(parseGs1WeightOrPrice({ code: '2012345012349', scheme: 'co' })).toMatchObject({
      kind: 'gs1-weight',
      sku: '12345',
    });
    expect(parseGs1WeightOrPrice({ code: '2112345001999', scheme: 'mx' })).toMatchObject({
      kind: 'gs1-price',
      sku: '12345',
    });
  });
});

describe('parseScan top-level', () => {
  it('classifies a 13-digit code with valid checksum as ean13', () => {
    const result = parseScan('9788471800213');
    expect(result.kind).toBe('ean13');
    expect(result.lookupCode).toBe('9788471800213');
    expect(result.checksumValid).toBe(true);
  });

  it('classifies an 8-digit code with valid checksum as ean8', () => {
    const result = parseScan('73513537');
    expect(result.kind).toBe('ean8');
    expect(result.checksumValid).toBe(true);
  });

  it('classifies a 12-digit code with valid checksum as upc-a', () => {
    const result = parseScan('042100005264');
    expect(result.kind).toBe('upc-a');
    expect(result.checksumValid).toBe(true);
  });

  it('classifies a corrupted 13-digit code as unknown with checksumValid false', () => {
    const result = parseScan('9788471800217');
    expect(result.kind).toBe('unknown');
    expect(result.checksumValid).toBe(false);
  });

  it('classifies a GS1 weight-embedded code with sku as lookupCode and weightKg', () => {
    const result = parseScan('2012345012349');
    expect(result.kind).toBe('gs1-weight');
    expect(result.lookupCode).toBe('12345');
    expect(result.weightKg).toBe(1.234);
  });

  it('classifies a GS1 price-embedded code with sku as lookupCode and priceMajor', () => {
    const result = parseScan('2112345001999');
    expect(result.kind).toBe('gs1-price');
    expect(result.lookupCode).toBe('12345');
    expect(result.priceMajor).toBe(1.99);
  });

  it('returns gs1-weight even with corrupted checksum so caller can decide policy', () => {
    // Same SKU/weight payload but corrupted check digit
    const result = parseScan('2012345012345');
    expect(result.kind).toBe('gs1-weight');
    expect(result.lookupCode).toBe('12345');
    expect(result.checksumValid).toBe(false);
  });

  it('classifies non-digit input as unknown', () => {
    const result = parseScan('ABC12345');
    expect(result.kind).toBe('unknown');
    expect(result.checksumValid).toBe(false);
  });

  it('classifies a length-5 code as unknown (below all symbologies)', () => {
    const result = parseScan('12345');
    expect(result.kind).toBe('unknown');
  });

  it('classifies a length-14 code as unknown (GS1-128 deferred)', () => {
    const result = parseScan('12345678901234');
    expect(result.kind).toBe('unknown');
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(parseScan('  9788471800213  ').kind).toBe('ean13');
  });

  it('honors the gs1Scheme option to disable GS1 decoding', () => {
    // With scheme='none', the GS1 layout is skipped — the code falls
    // back to ean13 classification (and the EAN-13 checksum drives
    // the kind).
    const result = parseScan('2012345012349', { gs1Scheme: 'none' });
    expect(result.kind).toBe('ean13');
    expect(result.lookupCode).toBe('2012345012349');
  });
});
