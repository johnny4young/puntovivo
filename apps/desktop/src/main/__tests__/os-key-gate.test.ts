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

function gate(
  states: Array<string | Error>,
  platform: NodeJS.Platform = 'win32',
  signal?: AbortSignal
) {
  const disk = fakeDisk(states);
  const logs: string[] = [];
  let waits = 0;
  let clock = 0;
  const wait = createOsKeyGate({
    platform,
    localStatePath: 'C:\\profile\\Local State',
    log: {
      info: (...args: unknown[]) => logs.push(String(args.at(-1))),
    } as unknown as PuntovivoLogger,
    onWait: () => {
      waits++;
    },
    ...(signal ? { signal } : {}),
    timeoutMs: 1_000,
    pollMs: 200,
    readLocalState: disk.read,
    sleep: async ms => {
      clock += ms;
    },
    now: () => clock,
  });
  return {
    wait,
    disk,
    logs,
    get waits() {
      return waits;
    },
  };
}

describe('createOsKeyGate', () => {
  it('never reads Local State outside Windows', async () => {
    const { wait, disk } = gate([new Error('must not read')], 'darwin');
    await wait();
    assert.equal(disk.reads, 0);
  });

  it('resolves at once when the key is already saved', async () => {
    const subject = gate([SAVED]);
    await subject.wait();
    assert.equal(subject.disk.reads, 1);
    assert.deepEqual(subject.logs, []);
    assert.equal(subject.waits, 0);
  });

  it('waits through a missing file and a key-less Local State', async () => {
    const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const subject = gate([missing, '{"browser":{}}', '{"os_crypt":{}}', SAVED]);
    await Promise.all([subject.wait(), subject.wait()]);
    assert.equal(subject.disk.reads, 4);
    assert.equal(subject.logs.length, 2);
    assert.equal(subject.waits, 1);
  });

  it('stops waiting when aborted and checks again on the next call', async () => {
    const abort = new AbortController();
    const subject = gate(['{}', '{}', SAVED], 'win32', abort.signal);
    abort.abort();
    await assert.rejects(subject.wait(), { name: 'AbortError' });
    assert.equal(subject.disk.reads, 2);
    await subject.wait();
    assert.equal(subject.disk.reads, 3);
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
