#!/usr/bin/env node
/**
 * Structural integrity of the drizzle migration chain.
 *
 * Two incidents in one stack motivated this gate, both invisible to every
 * other check and both only found by hand:
 *
 * 1. A rebase left the journal naming `0055_retail_inventory_counts` while
 *    the file on disk was still `0054_retail_inventory_counts.sql`. Nothing
 *    fails until boot, where the migrator reads a journal entry whose file
 *    does not exist.
 * 2. Two layers shipped their snapshot under the PREVIOUS migration's number.
 *    The stale content made `drizzle-kit generate` emit a table rebuild to
 *    correct a difference no real database has, and once two snapshots
 *    claimed the same parent, drizzle-kit refused to run at all.
 *
 * The checks below are structural only: they never read schema content, so
 * they stay fast and cannot drift with the schema.
 *
 * @module scripts/check-migration-chain
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SNAPSHOT_PATTERN = /^(\d{4})_snapshot\.json$/;

/**
 * @param {{journal: {entries: Array<{idx: number, when: number, tag: string}>},
 *   sqlTags: Set<string>, snapshots: Array<{number: string, id: unknown,
 *   prevId: unknown}>}} input
 * @returns {string[]} One line per violation; empty means the chain is sound.
 */
export function inspectMigrationChain({ journal, sqlTags, snapshots }) {
  const problems = [];
  const entries = journal.entries ?? [];

  // A journal entry with no file is a boot failure, not a lint nit.
  for (const entry of entries) {
    if (!sqlTags.has(entry.tag)) {
      problems.push(`journal entry ${entry.idx} names ${entry.tag}.sql, which does not exist`);
    }
  }

  // A file the journal never names is dead weight at best and a migration
  // someone believes ships at worst.
  const journalTags = new Set(entries.map(entry => entry.tag));
  for (const tag of sqlTags) {
    if (!journalTags.has(tag)) {
      problems.push(`${tag}.sql is not referenced by the journal`);
    }
  }

  // idx and when both order the chain; a duplicate makes that order undefined
  // and, for `when`, makes two migrations indistinguishable in the applied
  // table because it is stored as created_at.
  for (const [field, label] of [
    ['idx', 'index'],
    ['when', 'timestamp'],
    ['tag', 'tag'],
  ]) {
    const seen = new Map();
    for (const entry of entries) {
      const value = entry[field];
      if (seen.has(value)) {
        problems.push(
          `journal ${label} ${value} is used by both ${seen.get(value)} and ${entry.tag}`
        );
      }
      seen.set(value, entry.tag);
    }
  }

  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (current.idx <= previous.idx || current.when <= previous.when) {
      problems.push(`journal entry ${current.tag} does not advance past ${previous.tag}`);
    }
  }

  // A snapshot numbered past the journal is the misfiling that started this:
  // it means a migration's schema state is recorded under someone else's
  // number, so the next generate diffs against the wrong baseline.
  const numbersInJournal = new Set(entries.map(entry => entry.tag.slice(0, 4)));
  for (const snapshot of snapshots) {
    if (!numbersInJournal.has(snapshot.number)) {
      problems.push(
        `meta/${snapshot.number}_snapshot.json has no migration ${snapshot.number} in the journal`
      );
    }
  }

  // Two snapshots claiming one parent is the exact state drizzle-kit refuses
  // to run against.
  const byPrevId = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.prevId === undefined || snapshot.prevId === null) continue;
    if (byPrevId.has(snapshot.prevId)) {
      problems.push(
        `meta/${byPrevId.get(snapshot.prevId)}_snapshot.json and meta/${snapshot.number}_snapshot.json both claim the same parent`
      );
    }
    byPrevId.set(snapshot.prevId, snapshot.number);
  }

  return problems;
}

/** Read the chain off disk into the shape {@link inspectMigrationChain} takes. */
export function readMigrationChain(migrationsFolder) {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const sqlTags = new Set(
    readdirSync(migrationsFolder)
      .filter(name => name.endsWith('.sql'))
      .map(name => name.slice(0, -'.sql'.length))
  );
  const snapshots = readdirSync(resolve(migrationsFolder, 'meta'))
    .map(name => SNAPSHOT_PATTERN.exec(name))
    .filter(Boolean)
    .map(match => {
      const content = JSON.parse(readFileSync(resolve(migrationsFolder, 'meta', match[0]), 'utf8'));
      return { number: match[1], id: content.id, prevId: content.prevId };
    });
  return { journal, sqlTags, snapshots };
}

const MIGRATIONS_FOLDER = resolve(process.cwd(), 'packages/server/src/db/migrations');

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const problems = inspectMigrationChain(readMigrationChain(MIGRATIONS_FOLDER));
  if (problems.length > 0) {
    console.error('Migration chain check failed:');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log('Migration chain check passed.');
}
