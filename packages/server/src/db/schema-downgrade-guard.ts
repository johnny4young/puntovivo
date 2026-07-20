/**
 * A-06 — schema downgrade guard.
 *
 * `electron-updater` runs with `autoDownload: true` and rollback (
 * remaining) does not exist yet, so this failure mode is reachable in the
 * field: an OLD binary opens a DB that a NEWER binary already migrated. The
 * old binary's bundled journal has fewer migrations than the DB has applied;
 * nothing in the boot path noticed, and the process died later — mid-sale —
 * with an inscrutable `no such column` from whatever query touched the new
 * shape first.
 *
 * The guard turns that into an operator-facing refusal AT BOOT: if the DB
 * carries more applied migrations than this build's journal knows about, the
 * schema is from the future and continuing risks writing with stale
 * assumptions. Refusing is the safe move — the fix is operational (update
 * the app again, or restore the pre-update backup), not something runtime
 * code can negotiate.
 *
 * Deliberately count-based: drizzle records only content hashes plus
 * timestamps (never tags) in `__drizzle_migrations`, and the applied count
 * is monotonic under drizzle's runner. Comparing counts needs no hash
 * recomputation and cannot false-positive on a pending UPGRADE (applied <
 * bundled is the normal pre-migrate state and always passes).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The two calls the guard needs from better-sqlite3's Database. */
interface SqliteLike {
  prepare(sql: string): { get(): unknown };
}

/** Minimal slice of drizzle's `_journal.json` this guard reads. */
interface JournalLike {
  entries: Array<{ idx: number; tag: string }>;
}

/** Raised when the DB schema is newer than the running build. */
export class SchemaNewerThanAppError extends Error {
  constructor(applied: number, bundled: number) {
    super(
      `database schema is NEWER than this build: ${applied} migrations applied, ` +
        `but this app only knows ${bundled}. A newer version of Puntovivo already ` +
        `migrated this database - running an older binary against it risks data ` +
        `corruption, so startup was refused. Fix: update the app to the latest ` +
        `version (or restore the pre-update database backup before downgrading).`
    );
    this.name = 'SchemaNewerThanAppError';
  }
}

/**
 * Throws {@link SchemaNewerThanAppError} when `__drizzle_migrations` holds
 * more rows than the bundled journal has entries. No-op on fresh DBs (no
 * tracking table yet) and on pending upgrades (applied ≤ bundled).
 */
export function assertSchemaNotNewerThanApp(sqlite: SqliteLike, migrationsFolder: string): void {
  let applied: number;
  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as
      { n?: number } | undefined;
    applied = row?.n ?? 0;
  } catch {
    // Fresh DB: the tracking table does not exist until the first migrate.
    return;
  }
  if (applied === 0) return;

  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as JournalLike;
  const bundled = journal.entries.length;

  if (applied > bundled) {
    throw new SchemaNewerThanAppError(applied, bundled);
  }
}
