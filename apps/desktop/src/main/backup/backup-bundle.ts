/**
 * Backup bundle helpers, split into per-concern modules under
 * ./backup-bundle/ ( slice 31: constants, types, encryption, integrity,
 * detect, create, extract, sweep, filename, index).
 *
 * This thin re-export barrel keeps the `backup/backup-bundle` import path
 * stable for all consumers (main/index.ts, db-migrate-encryption.ts, the two
 * node --test suites) and the desktop build. The file shadows the new
 * ./backup-bundle/ directory in module resolution, so importers resolve here
 * unchanged.
 *
 * The helpers are PURE — no Electron / IPC dependencies — so they're
 * unit-testable via `node --test`.
 *
 * @module main/backup/backup-bundle
 */

export * from './backup-bundle/index.ts';
