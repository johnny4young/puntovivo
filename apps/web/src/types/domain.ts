// domain-entity layer of the former monolithic
// `types/index.ts`. These are the hand-written business-model shapes the
// renderer shares across the tRPC read side and the offline IndexedDB
// buffer. String-literal unions live in `./ui`; this module imports the
// ones it needs from there. Re-exported through `types/index.ts` (a shim
// kept for one release); prefer importing from `@/types/domain` directly
// in new code.
//
// Decomposed into per-domain modules under `domain/` ( slice 28).
// This file stays as a thin re-export barrel so existing importers resolve
// unchanged.

export * from './domain/index';
