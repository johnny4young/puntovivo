/** Reproducible JSON-vs-PVEC storage and scoring benchmark. */

import { performance } from 'node:perf_hooks';

import { cosineSimilarity } from '../services/ai/embeddings.js';
import {
  decodeEmbeddingVector,
  decodeLegacyEmbeddingJson,
  encodeEmbeddingVector,
} from '../services/ai/vector-codec.js';
import { computePercentile } from './budgets.js';

export interface VectorStorageBenchmarkConfig {
  dimensions: readonly number[];
  candidateCount: number;
  topK: number;
  warmupIterations: number;
  samples: number;
  seed: number;
}

export interface VectorStorageDimensionReport {
  dimensions: number;
  candidateCount: number;
  json: {
    totalBytes: number;
    bytesPerVector: number;
    decodeAndRankP95Ms: number;
  };
  pvecFloat32: {
    totalBytes: number;
    bytesPerVector: number;
    storageReductionPercent: number;
    decodeAndRankP95Ms: number;
    recallAtK: number;
    maxSimilarityError: number;
  };
}

export interface VectorStorageBenchmarkReport {
  config: VectorStorageBenchmarkConfig;
  results: VectorStorageDimensionReport[];
}

function createPrng(initialSeed: number): () => number {
  let state = initialSeed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function normalizedVector(dimensions: number, random: () => number): number[] {
  const vector = Array.from({ length: dimensions }, () => random() * 2 - 1);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map(value => value / norm);
}

function rankTopK(
  query: readonly number[],
  vectors: readonly (readonly number[])[],
  topK: number
): Array<{ index: number; similarity: number }> {
  return vectors
    .map((vector, index) => ({ index, similarity: cosineSimilarity(query, vector) }))
    .sort((left, right) => right.similarity - left.similarity || left.index - right.index)
    .slice(0, topK);
}

function measureP95(invoke: () => void, warmupIterations: number, samples: number): number {
  for (let iteration = 0; iteration < warmupIterations; iteration += 1) invoke();
  const elapsed: number[] = [];
  for (let iteration = 0; iteration < samples; iteration += 1) {
    const startedAt = performance.now();
    invoke();
    elapsed.push(performance.now() - startedAt);
  }
  return Number(computePercentile(elapsed, 95).toFixed(4));
}

function validateConfig(config: VectorStorageBenchmarkConfig): void {
  if (
    config.dimensions.length === 0 ||
    config.dimensions.some(value => !Number.isInteger(value) || value < 1 || value > 8192) ||
    !Number.isInteger(config.candidateCount) ||
    config.candidateCount < 1 ||
    !Number.isInteger(config.topK) ||
    config.topK < 1 ||
    config.topK > config.candidateCount ||
    !Number.isInteger(config.warmupIterations) ||
    config.warmupIterations < 0 ||
    !Number.isInteger(config.samples) ||
    config.samples < 1 ||
    !Number.isInteger(config.seed)
  ) {
    throw new Error('Invalid vector storage benchmark configuration');
  }
}

export function runVectorStorageBenchmark(
  config: VectorStorageBenchmarkConfig
): VectorStorageBenchmarkReport {
  validateConfig(config);
  const results = config.dimensions.map(dimensions => {
    const random = createPrng(config.seed ^ dimensions);
    const query = normalizedVector(dimensions, random);
    const sourceVectors = Array.from({ length: config.candidateCount }, () =>
      normalizedVector(dimensions, random)
    );
    const jsonVectors = sourceVectors.map(vector => JSON.stringify(vector));
    const pvecVectors = sourceVectors.map(encodeEmbeddingVector);

    const sourceRanking = rankTopK(query, sourceVectors, config.topK);
    const decodedPvecVectors = pvecVectors.map(encoded => {
      const decoded = decodeEmbeddingVector(encoded);
      if (!decoded) throw new Error('PVEC benchmark vector failed to decode');
      return decoded;
    });
    const pvecRanking = rankTopK(query, decodedPvecVectors, config.topK);
    const expectedIds = new Set(sourceRanking.map(result => result.index));
    const recallAtK =
      pvecRanking.filter(result => expectedIds.has(result.index)).length / config.topK;
    const pvecSimilarityByIndex = new Map(
      rankTopK(query, decodedPvecVectors, config.candidateCount).map(result => [
        result.index,
        result.similarity,
      ])
    );
    const maxSimilarityError = Math.max(
      ...rankTopK(query, sourceVectors, config.candidateCount).map(result =>
        Math.abs(result.similarity - (pvecSimilarityByIndex.get(result.index) ?? Number.NaN))
      )
    );

    const jsonTotalBytes = jsonVectors.reduce(
      (sum, encoded) => sum + Buffer.byteLength(encoded),
      0
    );
    const pvecTotalBytes = pvecVectors.reduce((sum, encoded) => sum + encoded.byteLength, 0);
    const jsonDecodeAndRankP95Ms = measureP95(
      () => {
        const decoded = jsonVectors.map(encoded => {
          const vector = decodeLegacyEmbeddingJson(encoded);
          if (!vector) throw new Error('JSON benchmark vector failed to decode');
          return vector;
        });
        rankTopK(query, decoded, config.topK);
      },
      config.warmupIterations,
      config.samples
    );
    const pvecDecodeAndRankP95Ms = measureP95(
      () => {
        const decoded = pvecVectors.map(encoded => {
          const vector = decodeEmbeddingVector(encoded);
          if (!vector) throw new Error('PVEC benchmark vector failed to decode');
          return vector;
        });
        rankTopK(query, decoded, config.topK);
      },
      config.warmupIterations,
      config.samples
    );

    return {
      dimensions,
      candidateCount: config.candidateCount,
      json: {
        totalBytes: jsonTotalBytes,
        bytesPerVector: Number((jsonTotalBytes / config.candidateCount).toFixed(2)),
        decodeAndRankP95Ms: jsonDecodeAndRankP95Ms,
      },
      pvecFloat32: {
        totalBytes: pvecTotalBytes,
        bytesPerVector: Number((pvecTotalBytes / config.candidateCount).toFixed(2)),
        storageReductionPercent: Number(((1 - pvecTotalBytes / jsonTotalBytes) * 100).toFixed(2)),
        decodeAndRankP95Ms: pvecDecodeAndRankP95Ms,
        recallAtK: Number(recallAtK.toFixed(6)),
        maxSimilarityError: Number(maxSimilarityError.toExponential(6)),
      },
    };
  });
  return { config, results };
}
