import { describe, expect, it } from 'vitest';

import {
  __vectorCodecInternals,
  decodeEmbeddingVector,
  decodeLegacyEmbeddingJson,
  decodeStoredEmbedding,
  encodeEmbeddingVector,
} from './vector-codec.js';

describe('embedding vector codec', () => {
  it('round-trips finite values through portable float32 storage', () => {
    const source = [1, -0.25, Math.PI, 0];
    const encoded = encodeEmbeddingVector(source);

    expect(encoded.subarray(0, 4).toString('ascii')).toBe('PVEC');
    expect(encoded.byteLength).toBe(
      __vectorCodecInternals.VECTOR_HEADER_BYTES + source.length * Float32Array.BYTES_PER_ELEMENT
    );
    expect(decodeEmbeddingVector(encoded)).toEqual(source.map(Math.fround));
  });

  it('decodes Uint8Array slices without reading adjacent bytes', () => {
    const encoded = encodeEmbeddingVector([0.5, -0.75]);
    const container = new Uint8Array(encoded.byteLength + 6);
    container.set(encoded, 3);

    expect(decodeEmbeddingVector(container.subarray(3, 3 + encoded.byteLength))).toEqual([
      0.5, -0.75,
    ]);
  });

  it('rejects unsupported, truncated, extended, and corrupt headers', () => {
    const encoded = encodeEmbeddingVector([1, 2, 3]);
    const unsupportedVersion = Buffer.from(encoded);
    unsupportedVersion.writeUInt8(2, 4);
    const unsupportedEncoding = Buffer.from(encoded);
    unsupportedEncoding.writeUInt8(2, 5);
    const nonzeroReserved = Buffer.from(encoded);
    nonzeroReserved.writeUInt16LE(1, 6);
    const wrongDimensions = Buffer.from(encoded);
    wrongDimensions.writeUInt32LE(4, 8);

    expect(decodeEmbeddingVector(Buffer.from('NOPE'))).toBeNull();
    expect(decodeEmbeddingVector(encoded.subarray(0, -1))).toBeNull();
    expect(decodeEmbeddingVector(Buffer.concat([encoded, Buffer.from([0])]))).toBeNull();
    expect(decodeEmbeddingVector(unsupportedVersion)).toBeNull();
    expect(decodeEmbeddingVector(unsupportedEncoding)).toBeNull();
    expect(decodeEmbeddingVector(nonzeroReserved)).toBeNull();
    expect(decodeEmbeddingVector(wrongDimensions)).toBeNull();
  });

  it('rejects invalid inputs before persistence', () => {
    expect(() => encodeEmbeddingVector([])).toThrow(RangeError);
    expect(() => encodeEmbeddingVector([Number.NaN])).toThrow(TypeError);
    expect(() => encodeEmbeddingVector([Number.POSITIVE_INFINITY])).toThrow(TypeError);
    expect(() => encodeEmbeddingVector([Number.MAX_VALUE])).toThrow(TypeError);
    expect(() =>
      encodeEmbeddingVector(new Array(__vectorCodecInternals.MAX_VECTOR_DIMENSIONS + 1).fill(0))
    ).toThrow(RangeError);
  });

  it('reads valid legacy JSON but rejects partially corrupt vectors', () => {
    expect(decodeLegacyEmbeddingJson('[1.5,-0.3,0]')).toEqual([1.5, -0.3, 0]);
    expect(decodeLegacyEmbeddingJson(null)).toBeNull();
    expect(decodeLegacyEmbeddingJson('{not-json')).toBeNull();
    expect(decodeLegacyEmbeddingJson('{"foo":1}')).toBeNull();
    expect(decodeLegacyEmbeddingJson('[1.5,"bad",null,2.5]')).toBeNull();
  });

  it('prefers PVEC and falls back to legacy JSON for upgrades or corrupt blobs', () => {
    expect(decodeStoredEmbedding(encodeEmbeddingVector([1, 0]), '[0,1]')).toEqual([1, 0]);
    expect(decodeStoredEmbedding(Buffer.from('corrupt'), '[0,1]')).toEqual([0, 1]);
  });
});
