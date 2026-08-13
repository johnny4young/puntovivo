/**
 * Versioned binary storage for embedding vectors.
 *
 * SQLite already stores arbitrary BLOB values, so this codec shrinks product
 * embeddings without adding another native extension to the Electron/Node
 * packaging matrix. The header is deliberately self-describing and
 * little-endian rather than persisting a platform-native TypedArray view.
 *
 * Layout (PVEC v1):
 * - bytes 0..3: ASCII magic `PVEC`
 * - byte 4: format version (1)
 * - byte 5: element encoding (1 = IEEE-754 float32 little-endian)
 * - bytes 6..7: reserved, zero
 * - bytes 8..11: unsigned dimension count, little-endian
 * - bytes 12..: float32 values
 *
 * @module services/ai/vector-codec
 */

const VECTOR_MAGIC = Buffer.from('PVEC', 'ascii');
const VECTOR_FORMAT_VERSION = 1;
const FLOAT32_ENCODING = 1;
const VECTOR_HEADER_BYTES = 12;
const FLOAT32_BYTES = 4;
const MAX_VECTOR_DIMENSIONS = 8192;

export type StoredEmbeddingBlob = Buffer | Uint8Array | null;

function hasValidDimensionCount(length: number): boolean {
  return Number.isInteger(length) && length > 0 && length <= MAX_VECTOR_DIMENSIONS;
}

function isFiniteFloat32(value: number): boolean {
  return Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

/** Encode one finite vector into the portable PVEC v1 representation. */
export function encodeEmbeddingVector(vector: readonly number[]): Buffer {
  if (!hasValidDimensionCount(vector.length)) {
    throw new RangeError(`Embedding dimensions must be between 1 and ${MAX_VECTOR_DIMENSIONS}`);
  }
  if (!vector.every(isFiniteFloat32)) {
    throw new TypeError('Embedding vector must contain only finite float32 values');
  }

  const encoded = Buffer.allocUnsafe(VECTOR_HEADER_BYTES + vector.length * FLOAT32_BYTES);
  VECTOR_MAGIC.copy(encoded, 0);
  encoded.writeUInt8(VECTOR_FORMAT_VERSION, 4);
  encoded.writeUInt8(FLOAT32_ENCODING, 5);
  encoded.writeUInt16LE(0, 6);
  encoded.writeUInt32LE(vector.length, 8);
  for (let index = 0; index < vector.length; index += 1) {
    encoded.writeFloatLE(vector[index]!, VECTOR_HEADER_BYTES + index * FLOAT32_BYTES);
  }
  return encoded;
}

/**
 * Decode PVEC v1. Invalid, truncated, unsupported, or non-finite payloads are
 * skipped instead of throwing inside an operator search request.
 */
export function decodeEmbeddingVector(raw: StoredEmbeddingBlob): number[] | null {
  if (!raw || raw.byteLength < VECTOR_HEADER_BYTES) return null;
  const encoded = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (!encoded.subarray(0, VECTOR_MAGIC.length).equals(VECTOR_MAGIC)) return null;
  if (encoded.readUInt8(4) !== VECTOR_FORMAT_VERSION) return null;
  if (encoded.readUInt8(5) !== FLOAT32_ENCODING) return null;
  if (encoded.readUInt16LE(6) !== 0) return null;

  const dimensions = encoded.readUInt32LE(8);
  if (!hasValidDimensionCount(dimensions)) return null;
  if (encoded.byteLength !== VECTOR_HEADER_BYTES + dimensions * FLOAT32_BYTES) return null;

  const vector = new Array<number>(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    const value = encoded.readFloatLE(VECTOR_HEADER_BYTES + index * FLOAT32_BYTES);
    if (!Number.isFinite(value)) return null;
    vector[index] = value;
  }
  return vector;
}

/** Decode the pre-PVEC JSON representation retained for upgrade compatibility. */
export function decodeLegacyEmbeddingJson(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !hasValidDimensionCount(parsed.length)) return null;
    if (
      !parsed.every((value): value is number => typeof value === 'number' && isFiniteFloat32(value))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Prefer the compact vector while preserving reads from pre-migration rows. */
export function decodeStoredEmbedding(
  blob: StoredEmbeddingBlob,
  legacyJson: string | null
): number[] | null {
  return decodeEmbeddingVector(blob) ?? decodeLegacyEmbeddingJson(legacyJson);
}

export const __vectorCodecInternals = {
  VECTOR_MAGIC,
  VECTOR_FORMAT_VERSION,
  FLOAT32_ENCODING,
  VECTOR_HEADER_BYTES,
  FLOAT32_BYTES,
  MAX_VECTOR_DIMENSIONS,
};
