/** Domain-specific retrieval metrics for embedding model comparisons. */

import { createHash } from 'node:crypto';

import { cosineSimilarity } from '../services/ai/embeddings.js';
import type { ProductEmbeddingCorpus } from './product-embedding-corpus.js';

export type EmbeddingVectorMap = Readonly<Record<string, readonly number[]>>;

export interface RankedEmbeddingResult {
  documentId: string;
  similarity: number;
  relevance: number;
}

export interface ProductEmbeddingQueryMetrics {
  queryId: string;
  ndcgAt10: number;
  recallAt3: number;
  reciprocalRank: number;
  top1Relevant: boolean;
  topResults: RankedEmbeddingResult[];
}

export interface ProductEmbeddingQualityReport {
  ndcgAt10: number;
  recallAt3: number;
  mrr: number;
  top1Accuracy: number;
  perQuery: ProductEmbeddingQueryMetrics[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function productEmbeddingCorpusSha256(corpus: ProductEmbeddingCorpus): string {
  return createHash('sha256').update(canonicalJson(corpus)).digest('hex');
}

function validateVectorMap(
  label: string,
  expectedIds: readonly string[],
  vectors: EmbeddingVectorMap
): number {
  const actualIds = Object.keys(vectors).sort();
  const sortedExpectedIds = [...expectedIds].sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(sortedExpectedIds)) {
    throw new Error(`${label} vector ids do not match the benchmark corpus`);
  }
  const dimensions = vectors[expectedIds[0] ?? '']?.length ?? 0;
  if (dimensions < 1) throw new Error(`${label} vectors must not be empty`);
  for (const id of expectedIds) {
    const vector = vectors[id];
    if (!vector || vector.length !== dimensions || !vector.every(Number.isFinite)) {
      throw new Error(`${label} vector ${id} is malformed or dimensionally inconsistent`);
    }
  }
  return dimensions;
}

function discountedCumulativeGain(grades: readonly number[]): number {
  return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Evaluate one embedding space using macro-averaged nDCG@10, recall@3, MRR,
 * and top-1 accuracy. Grade 2 or 3 counts as relevant for recall/MRR/top-1;
 * nDCG preserves all three relevance grades.
 */
export function evaluateProductEmbeddingQuality(
  corpus: ProductEmbeddingCorpus,
  documentVectors: EmbeddingVectorMap,
  queryVectors: EmbeddingVectorMap
): ProductEmbeddingQualityReport {
  const documentIds = corpus.documents.map(document => document.id);
  const queryIds = corpus.queries.map(query => query.id);
  const documentDimensions = validateVectorMap('Document', documentIds, documentVectors);
  const queryDimensions = validateVectorMap('Query', queryIds, queryVectors);
  if (documentDimensions !== queryDimensions) {
    throw new Error('Document and query embedding dimensions must match');
  }

  const perQuery = corpus.queries.map(query => {
    const queryVector = queryVectors[query.id]!;
    const ranked = corpus.documents
      .map(document => ({
        documentId: document.id,
        similarity: cosineSimilarity(queryVector, documentVectors[document.id]!),
        relevance: query.relevance[document.id] ?? 0,
      }))
      .sort(
        (left, right) =>
          right.similarity - left.similarity || left.documentId.localeCompare(right.documentId)
      );
    const top10 = ranked.slice(0, 10);
    const actualDcg = discountedCumulativeGain(top10.map(result => result.relevance));
    const idealGrades = Object.values(query.relevance)
      .sort((left, right) => right - left)
      .slice(0, 10);
    const idealDcg = discountedCumulativeGain(idealGrades);
    const relevantIds = new Set(
      Object.entries(query.relevance)
        .filter(([, grade]) => grade >= 2)
        .map(([documentId]) => documentId)
    );
    const top3Relevant = ranked.slice(0, 3).filter(result => relevantIds.has(result.documentId));
    const firstRelevantIndex = ranked.findIndex(result => relevantIds.has(result.documentId));

    return {
      queryId: query.id,
      ndcgAt10: roundMetric(idealDcg === 0 ? 0 : actualDcg / idealDcg),
      recallAt3: roundMetric(top3Relevant.length / relevantIds.size),
      reciprocalRank: roundMetric(firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1)),
      top1Relevant: relevantIds.has(ranked[0]?.documentId ?? ''),
      topResults: top10.map(result => ({
        ...result,
        similarity: roundMetric(result.similarity),
      })),
    };
  });

  const mean = (values: readonly number[]) =>
    roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    ndcgAt10: mean(perQuery.map(result => result.ndcgAt10)),
    recallAt3: mean(perQuery.map(result => result.recallAt3)),
    mrr: mean(perQuery.map(result => result.reciprocalRank)),
    top1Accuracy: mean(perQuery.map(result => (result.top1Relevant ? 1 : 0))),
    perQuery,
  };
}
