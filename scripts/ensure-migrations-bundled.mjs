#!/usr/bin/env node
// ENG-174 — guarantees the Drizzle migrations folder is present and
// populated before Electron Forge packages the app or launches in dev.
//
// The desktop bundle expects `packages/server/dist/db/migrations/` to
// carry the meta journal plus every `.sql` migration. Without it, the
// embedded server crashes at first boot inside
// `packages/server/src/db/index.ts` when it tries to read `_journal.json`.
// The Forge `extraResource` declaration in `apps/desktop/forge.config.ts`
// only asserts the path is valid at config-read time, NOT that the
// referenced folder actually contains anything — so a stale `npm run
// build --workspace=@puntovivo/server` would still let a packaging step
// succeed and ship a broken installer.
//
// This script runs in the `preflight:desktop` chain, AFTER
// `prepare:server` (which is what builds + copies the migrations into
// `dist/`) and BEFORE `electron:ensure:binary`. The order matters: if
// `dist/` has not been built yet there are no migrations to verify.
//
// Exit code policy (CLI mode):
//   0 — the folder + journal + every journal-referenced `.sql` migration exist.
//   1 — anything missing or malformed. The log emits the exact remediation.
//
// The core check is also exported as `checkMigrationsBundle()` so the
// colocated test can drive it without spawning a subprocess.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(
  repoRoot,
  'packages',
  'server',
  'dist',
  'db',
  'migrations'
);

const REMEDIATION_REBUILD = [
  'pnpm --filter @puntovivo/server run build',
  'then retry preflight:desktop',
];

const REMEDIATION_CLEAN_REBUILD = [
  'rm -rf packages/server/dist',
  'pnpm --filter @puntovivo/server run build',
  'then retry preflight:desktop',
];

function listSqlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    name => name.toLowerCase().endsWith('.sql') && statSync(join(dir, name)).isFile()
  );
}

/**
 * Pure check function. Returns:
 *   { ok: true, journalEntries, sqlFiles } when the folder, journal, and every
 *   journal-referenced SQL file are present.
 *   { ok: false, code, message, remediation } when anything is missing
 *   or malformed. The caller decides whether to log + exit (CLI) or
 *   assert on the shape (test).
 */
export function checkMigrationsBundle({ migrationsDir = DEFAULT_MIGRATIONS_DIR } = {}) {
  if (!existsSync(migrationsDir)) {
    return {
      ok: false,
      code: 'MISSING_FOLDER',
      message: `Missing migrations folder at ${migrationsDir}.`,
      remediation: REMEDIATION_REBUILD,
    };
  }

  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    return {
      ok: false,
      code: 'MISSING_JOURNAL',
      message: `Missing migration journal at ${journalPath}. The dist build is incomplete.`,
      remediation: REMEDIATION_REBUILD,
    };
  }

  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      code: 'MALFORMED_JOURNAL',
      message: `Migration journal at ${journalPath} is not valid JSON (${err instanceof Error ? err.message : String(err)}).`,
      remediation: REMEDIATION_CLEAN_REBUILD,
    };
  }

  const entries = Array.isArray(journal?.entries) ? journal.entries : null;
  if (!entries || entries.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_JOURNAL',
      message: `Migration journal at ${journalPath} has no entries.`,
      remediation: REMEDIATION_CLEAN_REBUILD,
    };
  }

  const sqlFiles = listSqlFiles(migrationsDir);
  if (sqlFiles.length === 0) {
    return {
      ok: false,
      code: 'MISSING_SQL_FILES',
      message: `Migration folder at ${migrationsDir} has a journal but no .sql files.`,
      remediation: REMEDIATION_CLEAN_REBUILD,
    };
  }

  for (const entry of entries) {
    if (typeof entry?.tag !== 'string' || entry.tag.length === 0) {
      return {
        ok: false,
        code: 'MALFORMED_JOURNAL',
        message: `Migration journal at ${journalPath} contains an entry without a valid tag.`,
        remediation: REMEDIATION_CLEAN_REBUILD,
      };
    }

    const migrationPath = join(migrationsDir, `${entry.tag}.sql`);
    if (!existsSync(migrationPath) || !statSync(migrationPath).isFile()) {
      return {
        ok: false,
        code: 'MISSING_JOURNAL_SQL',
        message: `Migration journal entry ${entry.tag} is missing its SQL file at ${migrationPath}.`,
        remediation: REMEDIATION_CLEAN_REBUILD,
      };
    }
  }

  return {
    ok: true,
    journalEntries: entries.length,
    sqlFiles: sqlFiles.length,
  };
}

function log(line) {
  process.stdout.write(`[ensure-migrations-bundled] ${line}\n`);
}

// CLI mode: only run when this file is executed directly, not when
// imported by the test (which calls `checkMigrationsBundle` directly).
// We compare both the canonical path (fileURLToPath of import.meta.url
// matches process.argv[1] exactly) AND the basename, because npm script
// invocation and workspace symlinks can yield divergent absolute paths
// even when this script is genuinely the entry point.
const scriptUrl = fileURLToPath(import.meta.url);
const argv1 = typeof process.argv[1] === 'string' ? process.argv[1] : null;
const isDirectExecution =
  argv1 !== null &&
  (argv1 === scriptUrl || argv1.endsWith('ensure-migrations-bundled.mjs'));

if (isDirectExecution) {
  const result = checkMigrationsBundle();
  if (!result.ok) {
    log(result.message);
    log('Remediation:');
    for (const line of result.remediation ?? []) {
      log(`  ${line}`);
    }
    process.exit(1);
  }
  log(
    `migrations bundled OK (${result.journalEntries} journal entries, ${result.sqlFiles} .sql files)`
  );
}
