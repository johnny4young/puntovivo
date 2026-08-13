/** Retained D2 benchmark evidence must stay bound to code and corpus. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ollamaProvider } from '../services/ai/providers/ollama.js';
import { __vectorCodecInternals } from '../services/ai/vector-codec.js';
import { SEMANTIC_CANDIDATE_LIMIT } from '../services/products/semantic-candidates.js';
import { productEmbeddingCorpusSha256 } from './product-embedding-benchmark.js';
import { PRODUCT_EMBEDDING_CORPUS } from './product-embedding-corpus.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function readEvidence<T>(filename: string): T {
  return JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'docs', 'assets', 'benchmarks', filename), 'utf8')
  ) as T;
}

interface ModelEvidence {
  schemaVersion: number;
  corpus: {
    version: number;
    sha256: string;
    inputPolicy: string;
    documents: number;
    queries: number;
  };
  host: Record<string, unknown>;
  results: Array<{
    model: string;
    installed: { digest: string | null } | null;
    dimensions: number;
    quality: { ndcgAt10: number; recallAt3: number; mrr: number; top1Accuracy: number };
  }>;
}

interface StorageEvidence {
  schemaVersion: number;
  host: Record<string, unknown>;
  benchmark: {
    config: { dimensions: number[]; candidateCount: number; topK: number; samples: number };
    results: Array<{
      dimensions: number;
      pvecFloat32: {
        bytesPerVector: number;
        storageReductionPercent: number;
        recallAtK: number;
        maxSimilarityError: number;
      };
    }>;
  };
}

describe('retained product embedding benchmark evidence', () => {
  it('binds model evidence to the current corpus and selected Ollama default', () => {
    const evidence = readEvidence<ModelEvidence>('product-embeddings-ollama-2026-08-09.json');
    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.corpus).toEqual({
      version: PRODUCT_EMBEDDING_CORPUS.version,
      sha256: productEmbeddingCorpusSha256(PRODUCT_EMBEDDING_CORPUS),
      inputPolicy: PRODUCT_EMBEDDING_CORPUS.inputPolicy,
      documents: PRODUCT_EMBEDDING_CORPUS.documents.length,
      queries: PRODUCT_EMBEDDING_CORPUS.queries.length,
    });
    expect(evidence.host).not.toHaveProperty('hostname');
    expect(evidence.results.map(result => result.model)).toEqual([
      'nomic-embed-text',
      'qwen3-embedding:0.6b',
      'embeddinggemma',
      'all-minilm',
    ]);

    const selected = evidence.results.find(
      result => result.model === ollamaProvider.defaultEmbeddingModelId
    );
    expect(selected).toMatchObject({
      model: 'embeddinggemma',
      installed: {
        digest: '85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1',
      },
      dimensions: 768,
      quality: {
        ndcgAt10: 0.961299,
        recallAt3: 1,
        mrr: 0.944444,
        top1Accuracy: 0.916667,
      },
    });
    for (const metric of ['ndcgAt10', 'recallAt3', 'mrr', 'top1Accuracy'] as const) {
      expect(selected!.quality[metric]).toBe(
        Math.max(...evidence.results.map(result => result.quality[metric]))
      );
    }
  });

  it('binds storage evidence to the 200-candidate PVEC v1 contract', () => {
    const evidence = readEvidence<StorageEvidence>('vector-storage-2026-08-09.json');
    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.host).not.toHaveProperty('hostname');
    expect(evidence.benchmark.config).toMatchObject({
      dimensions: [384, 768, 1024, 1536, 3072, 4096],
      candidateCount: SEMANTIC_CANDIDATE_LIMIT,
      topK: 10,
      samples: 30,
    });
    for (const result of evidence.benchmark.results) {
      expect(result.pvecFloat32.bytesPerVector).toBe(
        __vectorCodecInternals.VECTOR_HEADER_BYTES +
          result.dimensions * __vectorCodecInternals.FLOAT32_BYTES
      );
      expect(result.pvecFloat32.storageReductionPercent).toBeGreaterThan(80);
      expect(result.pvecFloat32.recallAtK).toBe(1);
      expect(result.pvecFloat32.maxSimilarityError).toBeLessThan(1e-7);
    }
  });
});
