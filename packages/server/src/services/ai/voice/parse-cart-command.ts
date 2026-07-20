/**
 * slice 3 — Voice cart-command parser.
 *
 * Takes a transcript produced by `ai.transcribeAudio` (Whisper) and
 * extracts a bounded ADD-only set of cart actions via `generateObject`,
 * then resolves each `productHint` to a real catalog row via the same
 * embeddings stack semantic search uses ().
 *
 * Decomposed into per-concern modules under `parse-cart-command/`
 * ( slice 25): schema, prompts, types, hydrate, parse. This file
 * stays as a thin re-export barrel so existing importers resolve
 * unchanged.
 *
 * @module services/ai/voice/parse-cart-command
 */

export * from './parse-cart-command/index.js';
