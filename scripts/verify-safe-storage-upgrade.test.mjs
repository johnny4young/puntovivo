import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertProofChain,
  assertSomethingUpgrades,
  checksumFor,
  electronZipName,
  keychainPartitionId,
  phaseTimeoutMessage,
  unexpectedElectronWarnings,
} from './verify-safe-storage-upgrade.mjs';

const chain = () => ({
  from: '43.8.3',
  to: '45.2.3',
  seal: {
    phase: 'seal',
    electron: '43.8.3',
    hadEnvelope: false,
    envelope: 'sealed',
    keyFingerprint: 'key',
    canary: 'row',
  },
  reopen: {
    phase: 'reopen',
    electron: '45.2.3',
    hadEnvelope: true,
    envelope: 'sealed',
    resealedEnvelope: 'resealed',
    keyFingerprint: 'key',
    canary: 'row',
  },
  rollback: {
    phase: 'rollback',
    electron: '43.8.3',
    hadEnvelope: true,
    envelope: 'resealed',
    keyFingerprint: 'key',
    canary: 'row',
  },
});

test('accepts a chain where every phase recovers the same key and row', () => {
  assert.doesNotThrow(() => assertProofChain(chain()));
});

test('rejects each way an upgrade could lose or replace the key', () => {
  const cases = [
    [p => (p.reopen.osKey = 'regenerated'), /reopen ran under another Local State key/],
    [p => (p.reopen.keyFingerprint = 'regenerated'), /reopen recovered another key/],
    [p => (p.rollback.keyFingerprint = 'regenerated'), /rollback recovered another key/],
    [p => (p.reopen.canary = 'other'), /reopen read another database value/],
    [p => (p.reopen.envelope = 'replaced'), /replaced the envelope/],
    [p => (p.rollback.envelope = 'stale'), /rollback did not read the new envelope/],
    [p => (p.seal.hadEnvelope = true), /found an existing envelope/],
    [p => (p.reopen.hadEnvelope = false), /saw no envelope/],
    [p => (p.reopen.electron = '43.8.3'), /upgrade phase ran 43\.8\.3/],
    [p => (p.rollback.electron = '45.2.3'), /old phases did not run/],
  ];
  for (const [mutate, expected] of cases) {
    const proof = chain();
    mutate(proof);
    assert.throws(() => assertProofChain(proof), expected);
  }
});

test('finds the archive checksum and refuses a release without one', () => {
  const name = electronZipName('43.8.3', 'win32', 'x64');
  assert.equal(name, 'electron-v43.8.3-win32-x64.zip');
  const hash = 'a'.repeat(64);
  assert.equal(checksumFor(`${'b'.repeat(64)} *other.zip\n${hash} *${name}\n`, name), hash);
  assert.throws(() => checksumFor(`${hash} *other.zip\n`, name), /no entry/);
});

test('flags Electron warnings the log policy would fail a run for', () => {
  const syncDeprecation =
    "(electron) 'safeStorage.encryptString' is deprecated and will be removed. Please use 'safeStorage.encryptStringAsync' instead.";
  const rejected = "(electron) 'session.getPreloads' is deprecated and will be removed.";
  const stderr = `${syncDeprecation}\r\nchromium noise\n${rejected}\n`;
  assert.deepEqual(unexpectedElectronWarnings(stderr), [syncDeprecation, rejected]);
  assert.deepEqual(unexpectedElectronWarnings(stderr, { previousBuild: true }), [rejected]);
});

test('refuses a proof where neither Electron nor the key store changes', () => {
  const same = { from: '45.2.2', to: '45.2.2', fromRef: 'v1.15.6' };
  assert.throws(
    () => assertSomethingUpgrades({ ...same, previousSource: 'store', currentSource: 'store' }),
    /nothing would be upgraded/
  );
  assert.doesNotThrow(() =>
    assertSomethingUpgrades({ ...same, previousSource: 'sync store', currentSource: 'async store' })
  );
  assert.doesNotThrow(() =>
    assertSomethingUpgrades({
      ...same,
      from: '43.8.3',
      previousSource: 'store',
      currentSource: 'store',
    })
  );
});

test('lists ad-hoc builds by CDHash and signed ones by team', () => {
  const adhoc =
    'Identifier=com.github.Electron\nCDHash=881086cbae7d\nSignature=adhoc\nTeamIdentifier=not set\n';
  assert.equal(keychainPartitionId(adhoc), 'cdhash:881086cbae7d');
  assert.equal(
    keychainPartitionId('CDHash=881086cbae7d\nTeamIdentifier=ABCDE12345\n'),
    'teamid:ABCDE12345'
  );
  assert.throws(() => keychainPartitionId('code object is not signed at all\n'), /neither/);
});

test('names the Keychain dialog when a macOS phase times out', () => {
  assert.match(
    phaseTimeoutMessage('seal', 'darwin'),
    /did not finish in 120 s; .*Keychain access dialog/
  );
  assert.doesNotMatch(phaseTimeoutMessage('seal', 'win32'), /Keychain/);
});
