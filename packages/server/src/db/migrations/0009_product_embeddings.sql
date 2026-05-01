-- ENG-033 — product embeddings + auto-categorize support.
--
-- Adds three nullable columns to `products` so any product row can
-- carry a vector representation of its `(name, description)` text used
-- for semantic search via cosine similarity. The vector is stored
-- inline as JSON-encoded float array in a TEXT column rather than a
-- BLOB because SQLite better-sqlite3 better handles JSON and the
-- vectors are small (1536 dims × 4 bytes ≈ 6 KB stringified).
--
-- The columns are nullable because (a) existing rows do not have an
-- embedding until `products.regenerateEmbeddings()` runs, and (b)
-- `ai.enabled=false` tenants never embed, so the columns remain null
-- forever for them — semantic search falls back to LIKE.
--
-- `embedding_model` records which model produced the vector so a
-- later upgrade (text-embedding-3-large, or a different provider)
-- can be detected and re-embedded without losing track of which rows
-- are stale.
--
-- Idempotency: Drizzle records this migration in `__drizzle_migrations`
-- after the first successful run. SQLite does not support `ADD COLUMN
-- IF NOT EXISTS`, so these statements intentionally rely on the journal
-- instead of a raw-DDL schema-sync fallback.

ALTER TABLE `products` ADD COLUMN `embedding` text;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `embedding_model` text;
--> statement-breakpoint
ALTER TABLE `products` ADD COLUMN `embedded_at` text;
