import { describe, it, after, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  MockEscPosTransport,
  __setEscPosTransportForTest,
} from '@puntovivo/server';
import { dispatchLocalEscpos } from '../local-bridge.ts';

// ENG-074b regression pin. The local hardware bridge MUST stay free
// of operational-table writes per ADR-0008 rule 6. The dispatcher
// only knows about ESC/POS bytes and the transport resolver from
// `@puntovivo/server` — no DB modules.
//
// Run via `npm run test --workspace=@puntovivo/desktop`.

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SOURCE = readFileSync(resolve(HERE, '..', 'local-bridge.ts'), 'utf8');

afterEach(() => {
  __setEscPosTransportForTest(null);
});

after(() => {
  __setEscPosTransportForTest(null);
});

describe('local-bridge dispatchLocalEscpos (ENG-074b)', () => {
  it('writes the bytes through the resolved transport on the happy path', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const result = await dispatchLocalEscpos({
      bytes: [0x1b, 0x40, 0x0a, 0x41, 0x42, 0x43],
      transport: { channel: 'mock' },
    });
    assert.equal(result.success, true);
    assert.equal(mock.captured.length, 1);
    assert.deepEqual(Array.from(mock.captured[0]!), [0x1b, 0x40, 0x0a, 0x41, 0x42, 0x43]);
  });

  it('accepts Uint8Array directly without converting twice', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const buf = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const result = await dispatchLocalEscpos({
      bytes: buf,
      transport: { channel: 'mock' },
    });
    assert.equal(result.success, true);
    assert.deepEqual(Array.from(mock.captured[0]!), [0xaa, 0xbb, 0xcc]);
  });

  it('returns EMPTY_PAYLOAD without touching the transport when bytes is empty', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const result = await dispatchLocalEscpos({
      bytes: [],
      transport: { channel: 'mock' },
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'EMPTY_PAYLOAD');
    assert.equal(mock.captured.length, 0);
  });

  it('surfaces transport write failures with EscPosTransportError normalization', async () => {
    const failingTransport = {
      async write() {
        throw new (await import('@puntovivo/server')).EscPosTransportError('forced failure', {
          kind: 'DEVICE_TIMEOUT',
          message: 'forced failure',
        });
      },
      async close() {},
    };
    __setEscPosTransportForTest(failingTransport);
    const result = await dispatchLocalEscpos({
      bytes: [0x1b],
      transport: { channel: 'mock' },
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'DEVICE_TIMEOUT');
    assert.match(result.error ?? '', /forced failure/);
  });

  it('NEVER imports any DB module (ADR-0008 rule 6)', () => {
    // Architectural lint: keep the bridge free of operational-table
    // imports. If a future refactor adds `services/db` or any
    // outbox helper, the test fails.
    const forbidden = [
      "from '../../../../../packages/server/src/db/",
      "from '@puntovivo/server/db",
      "from '../../db",
      "outbox",
      "drizzle",
    ];
    for (const term of forbidden) {
      assert.equal(
        BRIDGE_SOURCE.includes(term),
        false,
        `local-bridge.ts must not import "${term}" (ADR-0008 rule 6)`
      );
    }
  });
});
