import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEVICE_ID_FILENAME,
  deviceIdPathIn,
  readDeviceIdFromDir,
  writeDeviceIdToDir,
} from '../device-id-store.ts';

// regression suite for the device-id atomic store. The
// store is the desktop-side mirror of the localStorage cache used
// by the renderer; without it, a browser-cache wipe on the desktop
// build would force a re-registration on every launch.
describe('device-id-store', () => {
  let workdir: string;

  before(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'puntovivo-device-id-'));
  });

  after(async () => {
    if (workdir) {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it('returns null when the persisted file is missing', async () => {
    const id = await readDeviceIdFromDir(workdir);
    assert.equal(id, null, 'a fresh userData folder must report no device id');
  });

  it('round-trips a device id through write + read', async () => {
    const expected = 'dev-roundtrip-001';
    await writeDeviceIdToDir(workdir, expected);
    const persisted = await readDeviceIdFromDir(workdir);
    assert.equal(persisted, expected);
    // Verify the on-disk shape: plain UTF-8, no JSON envelope. The
    // renderer reads via a separate IPC channel and expects the
    // string verbatim.
    const onDisk = await readFile(deviceIdPathIn(workdir), 'utf8');
    assert.equal(onDisk, expected);
  });

  it('overwrites a previous id atomically without leaving the tmp file', async () => {
    await writeDeviceIdToDir(workdir, 'dev-first');
    await writeDeviceIdToDir(workdir, 'dev-second');
    const persisted = await readDeviceIdFromDir(workdir);
    assert.equal(persisted, 'dev-second');
    // No `device-id.txt.<uuid>.tmp` files should remain after a
    // successful rename. Listing the directory and asserting nothing
    // ends in `.tmp` catches a missing rename step.
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(workdir);
    const stale = entries.filter(name => name.endsWith('.tmp'));
    assert.deepEqual(stale, [], `tmp files must be renamed atomically; found ${stale.join(', ')}`);
    // Sanity: the canonical filename is still present.
    assert.ok(entries.includes(DEVICE_ID_FILENAME));
  });

  it('rejects empty values so a stray write cannot erase the registration', async () => {
    await writeDeviceIdToDir(workdir, 'dev-keep');
    await assert.rejects(() => writeDeviceIdToDir(workdir, ''), /DEVICE_SET_ID_REJECTED/);
    const persisted = await readDeviceIdFromDir(workdir);
    assert.equal(persisted, 'dev-keep', 'an empty write attempt must NOT wipe the existing id');
  });

  it('treats a whitespace-only file as missing', async () => {
    // Simulate a partially-corrupted file (e.g. a manual edit) by
    // writing whitespace. The reader trims and returns null so the
    // renderer triggers re-registration cleanly.
    await writeFile(deviceIdPathIn(workdir), '   \n\t  ', 'utf8');
    const persisted = await readDeviceIdFromDir(workdir);
    assert.equal(persisted, null);
  });
});
