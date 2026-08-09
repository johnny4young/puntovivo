/**
 * Run the Puntovivo product-retrieval corpus against local Ollama models.
 *
 * This is operator-invoked evidence, never a CI network dependency. It uses
 * the same symmetric raw product/query text policy as production and records
 * quality, dimensions, latency, model size, and JSON/PVEC storage estimates.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  evaluateProductEmbeddingQuality,
  productEmbeddingCorpusSha256,
  type EmbeddingVectorMap,
} from '../perf/product-embedding-benchmark.js';
import { PRODUCT_EMBEDDING_CORPUS } from '../perf/product-embedding-corpus.js';
import { encodeEmbeddingVector } from '../services/ai/vector-codec.js';

interface OllamaEmbedResponse {
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

interface OllamaTag {
  name: string;
  size: number;
  digest?: string;
  modified_at?: string;
}

interface OllamaTagsResponse {
  models?: OllamaTag[];
}

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(candidate => candidate.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function modelNames(): string[] {
  const raw = argument('models');
  if (!raw) throw new Error('Pass --models=model-a,model-b');
  const models = [
    ...new Set(
      raw
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    ),
  ];
  if (models.length === 0) throw new Error('At least one Ollama model is required');
  return models;
}

function normalizeBaseUrl(raw: string): string {
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Ollama base URL must use http or https');
  }
  return parsed.toString().replace(/\/$/, '');
}

function validateEmbeddings(raw: unknown, expectedCount: number): OllamaEmbedResponse {
  if (!raw || typeof raw !== 'object' || !('embeddings' in raw)) {
    throw new Error('Ollama returned no embeddings array');
  }
  const response = raw as OllamaEmbedResponse;
  if (!Array.isArray(response.embeddings) || response.embeddings.length !== expectedCount) {
    throw new Error(`Ollama returned ${response.embeddings?.length ?? 0}/${expectedCount} vectors`);
  }
  const dimensions = response.embeddings[0]?.length ?? 0;
  if (
    dimensions < 1 ||
    response.embeddings.some(
      vector => vector.length !== dimensions || !vector.every(value => Number.isFinite(value))
    )
  ) {
    throw new Error('Ollama returned malformed or inconsistent vectors');
  }
  return response;
}

async function embedBatch(
  baseUrl: string,
  model: string,
  input: readonly string[]
): Promise<{ response: OllamaEmbedResponse; elapsedMs: number }> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Ollama ${model} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return {
    response: validateEmbeddings(body, input.length),
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

function vectorMap(ids: readonly string[], vectors: readonly number[][]): EmbeddingVectorMap {
  return Object.fromEntries(ids.map((id, index) => [id, vectors[index]!])) as EmbeddingVectorMap;
}

function durationMs(nanoseconds: number | undefined): number | null {
  return nanoseconds === undefined ? null : Number((nanoseconds / 1_000_000).toFixed(2));
}

function averageNorm(vectors: readonly number[][]): number {
  const sum = vectors.reduce(
    (outer, vector) => outer + Math.sqrt(vector.reduce((inner, value) => inner + value * value, 0)),
    0
  );
  return Number((sum / vectors.length).toFixed(6));
}

function findTag(tags: readonly OllamaTag[], requestedModel: string): OllamaTag | null {
  const normalized = requestedModel.includes(':') ? requestedModel : `${requestedModel}:latest`;
  return tags.find(tag => tag.name === requestedModel || tag.name === normalized) ?? null;
}

async function main(): Promise<void> {
  const models = modelNames();
  const baseUrl = normalizeBaseUrl(argument('base-url') ?? 'http://127.0.0.1:11434');
  const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!tagsResponse.ok) throw new Error(`Ollama tags failed with HTTP ${tagsResponse.status}`);
  const tags = (((await tagsResponse.json()) as OllamaTagsResponse).models ?? []).filter(
    tag => typeof tag.name === 'string' && Number.isFinite(tag.size)
  );

  const results = [];
  for (const model of models) {
    const warmup = await embedBatch(baseUrl, model, ['Puntovivo embedding benchmark warmup']);
    const documents = await embedBatch(
      baseUrl,
      model,
      PRODUCT_EMBEDDING_CORPUS.documents.map(document => document.text)
    );
    const queries = await embedBatch(
      baseUrl,
      model,
      PRODUCT_EMBEDDING_CORPUS.queries.map(query => query.text)
    );
    const dimensions = documents.response.embeddings[0]!.length;
    if (queries.response.embeddings[0]!.length !== dimensions) {
      throw new Error(`${model} returned different query/document dimensions`);
    }
    const allVectors = [...documents.response.embeddings, ...queries.response.embeddings];
    const jsonBytes = allVectors.reduce(
      (sum, vector) => sum + Buffer.byteLength(JSON.stringify(vector)),
      0
    );
    const pvecBytes = allVectors.reduce(
      (sum, vector) => sum + encodeEmbeddingVector(vector).byteLength,
      0
    );
    const tag = findTag(tags, model);
    const quality = evaluateProductEmbeddingQuality(
      PRODUCT_EMBEDDING_CORPUS,
      vectorMap(
        PRODUCT_EMBEDDING_CORPUS.documents.map(document => document.id),
        documents.response.embeddings
      ),
      vectorMap(
        PRODUCT_EMBEDDING_CORPUS.queries.map(query => query.id),
        queries.response.embeddings
      )
    );

    results.push({
      model,
      installed: tag
        ? {
            name: tag.name,
            sizeBytes: tag.size,
            digest: tag.digest ?? null,
            modifiedAt: tag.modified_at ?? null,
          }
        : null,
      dimensions,
      averageL2Norm: averageNorm(allVectors),
      latency: {
        warmupElapsedMs: warmup.elapsedMs,
        catalogBatchElapsedMs: documents.elapsedMs,
        queryBatchElapsedMs: queries.elapsedMs,
        catalogProviderTotalMs: durationMs(documents.response.total_duration),
        catalogProviderLoadMs: durationMs(documents.response.load_duration),
        queryProviderTotalMs: durationMs(queries.response.total_duration),
        promptTokens:
          (documents.response.prompt_eval_count ?? 0) + (queries.response.prompt_eval_count ?? 0),
      },
      storage: {
        vectorCount: allVectors.length,
        jsonBytes,
        pvecBytes,
        pvecReductionPercent: Number(((1 - pvecBytes / jsonBytes) * 100).toFixed(2)),
      },
      quality,
    });
  }

  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    provider: 'ollama',
    endpointClass: new URL(baseUrl).hostname === '127.0.0.1' ? 'localhost' : 'configured',
    corpus: {
      version: PRODUCT_EMBEDDING_CORPUS.version,
      sha256: productEmbeddingCorpusSha256(PRODUCT_EMBEDDING_CORPUS),
      inputPolicy: PRODUCT_EMBEDDING_CORPUS.inputPolicy,
      documents: PRODUCT_EMBEDDING_CORPUS.documents.length,
      queries: PRODUCT_EMBEDDING_CORPUS.queries.length,
    },
    host: {
      runnerClass: process.env.CI ? 'ci' : 'local',
      os: `${platform()} ${release()}`,
      arch: process.arch,
      node: process.version,
      logicalCpuCount: cpus().length,
      cpuModel: cpus()[0]?.model ?? 'unknown',
      totalMemoryGb: Number((totalmem() / 1024 ** 3).toFixed(2)),
    },
    results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = argument('output');
  if (output) {
    const destination = resolve(process.cwd(), output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, serialized, 'utf8');
    process.stdout.write(`product-embedding-benchmark wrote ${destination}\n`);
    process.stdout.write(
      `${JSON.stringify(
        results.map(result => ({
          model: result.model,
          dimensions: result.dimensions,
          ndcgAt10: result.quality.ndcgAt10,
          recallAt3: result.quality.recallAt3,
          mrr: result.quality.mrr,
          top1Accuracy: result.quality.top1Accuracy,
          warmupElapsedMs: result.latency.warmupElapsedMs,
          catalogBatchElapsedMs: result.latency.catalogBatchElapsedMs,
          queryBatchElapsedMs: result.latency.queryBatchElapsedMs,
        })),
        null,
        2
      )}\n`
    );
    return;
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
