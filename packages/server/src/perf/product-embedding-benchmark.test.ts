import { describe, expect, it } from 'vitest';

import {
  evaluateProductEmbeddingQuality,
  productEmbeddingCorpusSha256,
} from './product-embedding-benchmark.js';
import { PRODUCT_EMBEDDING_CORPUS } from './product-embedding-corpus.js';

describe('product embedding benchmark contract', () => {
  it('pins unique ids, valid relevance targets, and the corpus digest', () => {
    const documentIds = PRODUCT_EMBEDDING_CORPUS.documents.map(document => document.id);
    const queryIds = PRODUCT_EMBEDDING_CORPUS.queries.map(query => query.id);

    expect(new Set(documentIds).size).toBe(documentIds.length);
    expect(new Set(queryIds).size).toBe(queryIds.length);
    expect(PRODUCT_EMBEDDING_CORPUS.documents).toHaveLength(36);
    expect(PRODUCT_EMBEDDING_CORPUS.queries).toHaveLength(24);
    for (const query of PRODUCT_EMBEDDING_CORPUS.queries) {
      expect(Object.values(query.relevance).some(grade => grade >= 2)).toBe(true);
      expect(Object.keys(query.relevance).every(id => documentIds.includes(id))).toBe(true);
    }
    expect(productEmbeddingCorpusSha256(PRODUCT_EMBEDDING_CORPUS)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives a perfect score to an embedding space aligned with graded relevance', () => {
    const documents = Object.fromEntries(
      PRODUCT_EMBEDDING_CORPUS.documents.map((document, index) => {
        const vector = new Array<number>(PRODUCT_EMBEDDING_CORPUS.documents.length).fill(0);
        vector[index] = 1;
        return [document.id, vector];
      })
    );
    const queries = Object.fromEntries(
      PRODUCT_EMBEDDING_CORPUS.queries.map(query => {
        const vector = PRODUCT_EMBEDDING_CORPUS.documents.map(
          document => (query.relevance[document.id] ?? 0) / 3
        );
        return [query.id, vector];
      })
    );

    const report = evaluateProductEmbeddingQuality(PRODUCT_EMBEDDING_CORPUS, documents, queries);
    expect(report.ndcgAt10).toBe(1);
    expect(report.recallAt3).toBe(1);
    expect(report.mrr).toBe(1);
    expect(report.top1Accuracy).toBe(1);
  });

  it('fails closed on missing ids, inconsistent dimensions, and non-finite values', () => {
    const documents = Object.fromEntries(
      PRODUCT_EMBEDDING_CORPUS.documents.map(document => [document.id, [1, 0]])
    );
    const queries = Object.fromEntries(
      PRODUCT_EMBEDDING_CORPUS.queries.map(query => [query.id, [1, 0]])
    );

    const missing = { ...documents };
    delete missing[PRODUCT_EMBEDDING_CORPUS.documents[0]!.id];
    expect(() =>
      evaluateProductEmbeddingQuality(PRODUCT_EMBEDDING_CORPUS, missing, queries)
    ).toThrow(/ids/);
    expect(() =>
      evaluateProductEmbeddingQuality(PRODUCT_EMBEDDING_CORPUS, documents, {
        ...queries,
        [PRODUCT_EMBEDDING_CORPUS.queries[0]!.id]: [1],
      })
    ).toThrow(/inconsistent/);
    expect(() =>
      evaluateProductEmbeddingQuality(PRODUCT_EMBEDDING_CORPUS, documents, {
        ...queries,
        [PRODUCT_EMBEDDING_CORPUS.queries[0]!.id]: [Number.NaN, 0],
      })
    ).toThrow(/malformed/);
  });
});
