# 0011 — Product Search Vector Storage and Model Selection

> Status: Accepted
> Date: 2026-08-08

## Context

Interactive product search is a latency- and memory-sensitive operator path in
a local-first desktop application. ADR-0001 keeps the local SQLite database as
the store authority, while Electron and standalone Node use different native
ABIs. Adding a vector extension therefore affects encryption, migrations,
packaging, Node 24, Electron 43, macOS, Linux, and Windows rather than only one
SQL query.

The previous implementation stored every embedding as a decimal JSON array.
It also lacked a retained, product-domain comparison for selecting the default
local model. General leaderboards are useful discovery inputs, but they do not
measure Puntovivo's neutral Latin American Spanish, cross-language product
queries, or distractor catalog.

## Decision

Puntovivo stores new product embeddings as a versioned `PVEC` float32 SQLite
BLOB and keeps the legacy JSON column readable during upgrades. It does not add
a vector database or SQLite extension at this stage.

Interactive semantic search continues to use the tenant-safe literal shortlist
and hard 200-candidate ceiling defined by the product-search boundary. The
application decodes and cosine-ranks only that bounded pool in JavaScript.
Embeddings are derived search data, not sync or fiscal authority.

This is intentionally hybrid retrieval rather than catalog-wide approximate
nearest-neighbor search. A query must first share an exact, FTS, or substring
term with a product before embeddings can rerank it; a pure concept with no
literal overlap may therefore return no result. The operator copy states that
boundary instead of promising global semantic recall that the current storage
path cannot provide.

The `PVEC` v1 representation is deliberately portable:

- four-byte `PVEC` magic, format and element-encoding bytes, zeroed reserved
  bytes, and a little-endian unsigned dimension count;
- IEEE-754 float32 elements written explicitly in little-endian order;
- a maximum of 8,192 dimensions and an exact payload-length check;
- fail-closed decoding for unsupported, truncated, extended, or non-finite
  values;
- legacy JSON fallback until explicit catalog regeneration writes the BLOB and
  clears the old value.

For Ollama, `embeddinggemma` becomes the default embedding model. OpenAI keeps
`text-embedding-3-small`; switching providers or models still requires explicit
catalog regeneration because equal dimensions do not imply a compatible vector
space.

## Product-domain evidence

The retained model corpus contains 36 representative products and 24 graded
queries across grocery, pharmacy, hardware, and electronics. It includes
neutral Latin American Spanish, English-to-Spanish retrieval, synonyms, and
nearby distractors. The evaluator records nDCG@10, recall@3, MRR, top-1
accuracy, full top-ten evidence, dimensions, storage, and observed batch
latency.

On the 2026-08-08 local evidence, `embeddinggemma` led all four evaluated
Ollama models:

| Model                  | Dimensions |  nDCG@10 | Recall@3 |      MRR |    Top-1 |
| ---------------------- | ---------: | -------: | -------: | -------: | -------: |
| `embeddinggemma`       |        768 | 0.961299 | 1.000000 | 0.944444 | 0.916667 |
| `qwen3-embedding:0.6b` |      1,024 | 0.855279 | 0.937500 | 0.815972 | 0.666667 |
| `nomic-embed-text`     |        768 | 0.767351 | 0.729167 | 0.780989 | 0.750000 |
| `all-minilm`           |        384 | 0.618853 | 0.625000 | 0.605049 | 0.541667 |

The observed one-time warmup ranged from about 0.58 to 8.74 seconds. That
measurement is order-, cache-, and host-sensitive, so it is retained for
diagnosis but is not treated as a user-latency SLA or a deterministic model
ranking. Provider failures still use the existing honest literal-search
fallback.

The storage benchmark generated deterministic normalized vectors at 384,
768, 1,024, 1,536, 3,072, and 4,096 dimensions, then decoded and ranked the
same 200-candidate pool for 30 samples. `PVEC` reduced storage by 80.66–81.29%
against decimal JSON, preserved recall@10 at 1.0, kept maximum cosine error
below `5e-9`, and reduced decode-plus-rank p95. At 768 dimensions it used 3,084
bytes per vector and measured 0.4993 ms p95, versus 16,159.09 bytes and 5.2705
ms for JSON. At 1,536 dimensions it used 6,156 bytes rather than the previously
assumed roughly 6 KB JSON value; the measured JSON representation was 32,525.6
bytes per vector.

The retained reports and corpus hash are pinned by tests:

- `docs/assets/benchmarks/product-embeddings-ollama-2026-08-09.json`
- `docs/assets/benchmarks/vector-storage-2026-08-09.json`
- `packages/server/src/perf/product-embedding-evidence.test.ts`

## Market comparison

The shortlist uses official product documentation and remains a discovery
list, not a claimed Puntovivo benchmark result:

- [Ollama embeddings](https://docs.ollama.com/capabilities/embeddings) recommends
  `embeddinggemma`, `qwen3-embedding`, and `all-minilm` for local generation.
- [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings)
  offers the 1,536-dimension `text-embedding-3-small` and 3,072-dimension
  `text-embedding-3-large`, with optional dimension reduction and normalized
  outputs.
- [Google Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
  provides task-specific inputs and configurable output dimensions; the
  [`gemini-embedding-2` model](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2)
  supports multilingual embedding spaces that are incompatible with earlier
  models.
- [Voyage embeddings](https://docs.voyageai.com/docs/embeddings) exposes the
  Voyage 4 family with query/document input types, configurable dimensions,
  and quantized output formats.
- [Cohere Embed](https://docs.cohere.com/docs/cohere-embed) supports multilingual
  retrieval, explicit search-query/search-document input types, configurable
  dimensions, and quantized output.

No cloud alternative is selected from marketing specifications or public
leaderboards alone. It must run the same corpus with real credentials, record
cost and latency, and meet or improve the retained relevance contract before
replacing an active default.

## Alternatives Rejected for Now

- **Keep decimal JSON** — it wastes about five times the storage and makes the
  bounded decode/rank path materially slower without adding portability.
- **Store a raw platform-native typed-array view** — byte order, element type,
  and dimensions would be implicit, making corrupt or incompatible payloads
  difficult to reject safely.
- **Adopt [sqlite-vec](https://github.com/asg017/sqlite-vec)** — it is a useful
  SQLite-native direction but remains pre-v1/alpha and adds another native
  extension to every Node/Electron/OS packaging target. The current bounded
  pool does not demonstrate a need for that risk.
- **Replace SQLite with [libSQL](https://docs.turso.tech/libsql)** — vector
  support does not offset the cost of changing the encrypted local-authority
  engine, Drizzle/migration behavior, backup/recovery proof, and desktop ABI
  matrix.
- **Move search to [pgvector](https://github.com/pgvector/pgvector)** — its
  HNSW and IVFFlat indexes are mature options for a PostgreSQL service, but a
  remote/server authority would violate the current offline local-authority
  boundary and add operational dependency to each keystroke.

## Consequences and Revisit Trigger

- Migration `0037_product_embedding_blob` is additive. Older JSON vectors stay
  readable and are replaced only during an operator-requested regeneration.
  Regeneration validates the full provider batch first and replaces the tenant
  catalog in one SQLite transaction, so a local write or codec failure cannot
  leave a partially migrated model/format set.
- A corrupted BLOB cannot crash an interactive search; decoding skips it or
  uses a valid retained JSON value. Health counts and model drift remain
  visible to managers and administrators.
- Float32 introduces bounded precision loss. The retained recall and cosine
  error checks make that trade-off explicit.
- Local Ollama quality is proven only for corpus v1 and the recorded model
  digests. Corpus or model changes require new evidence rather than editing the
  existing report.
- Reconsider an indexed vector extension only when production-like evidence
  shows the 200-candidate lane missing relevance or exceeding its budget at the
  50,000-product tier. Adoption then requires the same benchmark plus clean
  rebuild, packaging, migration, backup/restore, and smoke evidence on Node 24,
  Electron 43, Linux, Windows, and supported macOS Sequoia/Tahoe targets.
- Treat repeated meaning-only misses as relevance evidence for that revisit,
  not as justification to scan and decode an unbounded tenant catalog.

## Verification

- `pnpm --filter @puntovivo/server run benchmark:vector-storage -- --output=<path>`
- `pnpm --filter @puntovivo/server run benchmark:product-embeddings -- --models=<models> --output=<path>`
- `pnpm run ci:server`
- `pnpm run ci:desktop`
