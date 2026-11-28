import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  inspectMigrationChain,
  isMainModule,
  readMigrationChain,
} from './check-migration-chain.mjs';

/** A minimal sound chain: two migrations, two snapshots, linked. */
function soundChain() {
  return {
    journal: {
      entries: [
        { idx: 54, when: 100, tag: '0054_split_return_state' },
        { idx: 55, when: 200, tag: '0055_retail_inventory_counts' },
      ],
    },
    sqlTags: new Set(['0054_split_return_state', '0055_retail_inventory_counts']),
    snapshots: [
      { number: '0054', id: 'a', prevId: 'root' },
      { number: '0055', id: 'b', prevId: 'a' },
    ],
  };
}

test('a sound chain reports nothing', () => {
  assert.deepEqual(inspectMigrationChain(soundChain()), []);
});

test('catches a journal entry whose file does not exist', () => {
  // Incident 1: a rebase renumbered the journal but not the file. Nothing
  // else fails until the migrator reads the entry at boot.
  const chain = soundChain();
  chain.sqlTags.delete('0055_retail_inventory_counts');
  chain.sqlTags.add('0054_retail_inventory_counts');
  const problems = inspectMigrationChain(chain);
  assert.match(problems.join('\n'), /0055_retail_inventory_counts\.sql, which does not exist/);
  assert.match(problems.join('\n'), /0054_retail_inventory_counts\.sql is not referenced/);
});

test('catches two snapshots claiming the same parent', () => {
  // Incident 2: a layer filed its snapshot under the previous number, so both
  // pointed at the same ancestor. drizzle-kit refuses to run in this state.
  const chain = soundChain();
  chain.snapshots[1].prevId = 'root';
  assert.match(
    inspectMigrationChain(chain).join('\n'),
    /0054_snapshot\.json and meta\/0055_snapshot\.json both claim the same parent/
  );
});

test('catches a snapshot filed against a migration that does not exist', () => {
  const chain = soundChain();
  chain.snapshots.push({ number: '0056', id: 'c', prevId: 'b' });
  assert.match(
    inspectMigrationChain(chain).join('\n'),
    /0056_snapshot\.json has no migration 0056 in the journal/
  );
});

test('catches a duplicated index, timestamp, or tag', () => {
  for (const [field, value, pattern] of [
    ['idx', 54, /journal index 54 is used by both/],
    ['when', 100, /journal timestamp 100 is used by both/],
    ['tag', '0054_split_return_state', /journal tag 0054_split_return_state is used by both/],
  ]) {
    const chain = soundChain();
    chain.journal.entries[1][field] = value;
    if (field === 'tag') chain.sqlTags.delete('0055_retail_inventory_counts');
    assert.match(inspectMigrationChain(chain).join('\n'), pattern, `field ${field}`);
  }
});

test('catches an entry that does not advance the chain', () => {
  const chain = soundChain();
  chain.journal.entries[1].when = 50;
  assert.match(
    inspectMigrationChain(chain).join('\n'),
    /0055_retail_inventory_counts does not advance past 0054_split_return_state/
  );
});

test('the repository chain itself is sound', () => {
  // The gate must agree with the tree it ships in, or it is decoration.
  const folder = resolve(process.cwd(), 'packages/server/src/db/migrations');
  assert.deepEqual(inspectMigrationChain(readMigrationChain(folder)), []);
});

const GATE = resolve(import.meta.dirname, 'check-migration-chain.mjs');

test('the entry guard recognises the script itself, symlinks included', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chain-gate-'));
  try {
    const moduleUrl = pathToFileURL(GATE).href;
    assert.equal(isMainModule(GATE, moduleUrl), true);
    assert.equal(isMainModule(undefined, moduleUrl), false);
    assert.equal(isMainModule(join(dir, 'missing.mjs'), moduleUrl), false);
    assert.equal(isMainModule(import.meta.filename, moduleUrl), false);
    try {
      const link = join(dir, 'gate.mjs');
      symlinkSync(GATE, link);
      assert.equal(isMainModule(link, moduleUrl), true);
    } catch (error) {
      // Symlinks can need elevated rights on Windows: the direct case still counts.
      if (error?.code !== 'EPERM') throw error;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reading a folder without a chain fails instead of reporting a sound one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chain-gate-empty-'));
  try {
    assert.throws(() => readMigrationChain(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
