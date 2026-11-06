import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PuntovivoLogger } from '@puntovivo/server';
import { createOsKeyGate } from '../os-key-gate.ts';

const SAVED = JSON.stringify({ os_crypt: { encrypted_key: 'RFBBUEkBAAAA' } });

function fakeDisk(states: Array<string | Error>) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    read: async () => {
      const state = states[Math.min(reads++, states.length - 1)]!;
      if (state instanceof Error) throw state;
      return state;
    },
  };
}

function gate(states: Array<string | Error>, platform: NodeJS.Platform = 'win32') {
  const disk = fakeDisk(states);
  const logs: string[] = [];
  let clock = 0;
  const wait = createOsKeyGate({
    platform,
    localStatePath: 'C:\\profile\\Local State',
    log: {
      info: (...args: unknown[]) => logs.push(String(args.at(-1))),
    } as unknown as PuntovivoLogger,
    timeoutMs: 1_000,
    pollMs: 200,
    readLocalState: disk.read,
    sleep: async ms => {
      clock += ms;
    },
    now: () => clock,
  });
  return { wait, disk, logs };
}

describe('createOsKeyGate', () => {
  it('never reads Local State outside Windows', async () => {
    const { wait, disk } = gate([new Error('must not read')], 'darwin');
    await wait();
    assert.equal(disk.reads, 0);
  });

  it('resolves at once when the key is already saved', async () => {
    const { wait, disk, logs } = gate([SAVED]);
    await wait();
    assert.equal(disk.reads, 1);
    assert.deepEqual(logs, []);
  });

  it('waits through a missing file and a key-less Local State', async () => {
    const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const { wait, disk, logs } = gate([missing, '{"browser":{}}', '{"os_crypt":{}}', SAVED]);
    await Promise.all([wait(), wait()]);
    assert.equal(disk.reads, 4);
    assert.equal(logs.length, 2);
  });

  it('rejects after the timeout and checks again on the next call', async () => {
    const { wait, disk } = gate(['{}']);
    await assert.rejects(
      wait(),
      /did not save the safeStorage key .* within 1 s; nothing was sealed/
    );
    const readsAfterTimeout = disk.reads;
    await assert.rejects(wait());
    assert.ok(disk.reads > readsAfterTimeout);
  });
});
