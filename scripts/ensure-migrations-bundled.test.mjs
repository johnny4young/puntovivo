/**
 * ENG-174 — preflight guard for the migrations bundle.
 *
 * Pins every failure code the guard emits so a future regression
 * (e.g. silently swallowing a missing folder) is caught at CI time.
 * The CLI mode is exercised by package.json scripts in real runs;
 * this test drives the exported `checkMigrationsBundle` directly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMigrationsBundle } from './ensure-migrations-bundled.mjs';

function makeScratch(prefix) {
  return mkdtempSync(join(tmpdir(), `puntovivo-${prefix}-`));
}

test('returns ok when folder + journal + sql files exist', () => {
  const dir = makeScratch('migrations-ok');
  try {
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', entries: [{ idx: 0, tag: '0000_baseline' }] }),
      'utf8'
    );
    writeFileSync(join(dir, '0000_baseline.sql'), 'CREATE TABLE x (id INTEGER);', 'utf8');

    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.journalEntries, 1);
    assert.equal(result.sqlFiles, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns MISSING_FOLDER when the migrations directory does not exist', () => {
  const dir = join(tmpdir(), 'puntovivo-migrations-does-not-exist-XXXX');
  const result = checkMigrationsBundle({ migrationsDir: dir });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_FOLDER');
  assert.match(result.message, /Missing migrations folder/);
});

test('returns MISSING_JOURNAL when the folder exists but the journal does not', () => {
  const dir = makeScratch('migrations-no-journal');
  try {
    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_JOURNAL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns MALFORMED_JOURNAL when the journal is not valid JSON', () => {
  const dir = makeScratch('migrations-bad-json');
  try {
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(join(dir, 'meta', '_journal.json'), '{ this is not json', 'utf8');

    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MALFORMED_JOURNAL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns MALFORMED_JOURNAL when an entry is missing its tag field', () => {
  const dir = makeScratch('migrations-untagged-entry');
  try {
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        entries: [{ idx: 0 }],
      }),
      'utf8'
    );
    writeFileSync(join(dir, '0000_baseline.sql'), 'CREATE TABLE x (id INTEGER);', 'utf8');

    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MALFORMED_JOURNAL');
    assert.match(result.message, /without a valid tag/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns EMPTY_JOURNAL when the journal has no entries', () => {
  const dir = makeScratch('migrations-empty-journal');
  try {
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', entries: [] }),
      'utf8'
    );
    writeFileSync(join(dir, '0000_baseline.sql'), 'CREATE TABLE x (id INTEGER);', 'utf8');

    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EMPTY_JOURNAL');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns MISSING_SQL_FILES when the journal is valid but no .sql files exist', () => {
  const dir = makeScratch('migrations-no-sql');
  try {
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ version: '7', entries: [{ idx: 0, tag: '0000_baseline' }] }),
      'utf8'
    );
    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_SQL_FILES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns MISSING_JOURNAL_SQL when one journal entry lacks its .sql file', () => {
  const dir = makeScratch('migrations-partial-sql');
  try {
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        entries: [
          { idx: 0, tag: '0000_baseline' },
          { idx: 1, tag: '0001_missing' },
        ],
      }),
      'utf8'
    );
    writeFileSync(join(dir, '0000_baseline.sql'), 'CREATE TABLE x (id INTEGER);', 'utf8');

    const result = checkMigrationsBundle({ migrationsDir: dir });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MISSING_JOURNAL_SQL');
    assert.match(result.message, /0001_missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
