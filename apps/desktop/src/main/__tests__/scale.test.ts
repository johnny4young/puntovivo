import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isScaleConfig,
  parseScaleFrame,
  splitFrames,
  type ScaleConfig,
} from '../scale/protocol.ts';
import { readScaleWeight, type ScalePortHandle } from '../scale/reader.ts';
import { createScalePreferences } from '../scale/preferences.ts';
import { openErrorCode, ScaleOpenError } from '../scale/serial-port.ts';
import {
  getScaleSettings,
  getScaleStatus,
  readScale,
  saveScaleSettings,
  testScale,
  type ScaleDependencies,
} from '../ipc/scale-handlers.ts';

const config: ScaleConfig = {
  path: '/dev/tty.usbserial-1',
  protocol: 'continuous',
  baudRate: 9600,
  framing: '8N1',
};

/** A port that answers each poll byte, or streams frames on its own when replies is a list. */
function fakePort(
  reply: (poll: number) => string | null,
  stream: string[] = []
): ScalePortHandle & {
  writes: number[];
  closed: boolean;
} {
  const pending: string[] = [...stream];
  let wake: (() => void) | null = null;
  const port = {
    writes: [] as number[],
    closed: false,
    async read() {
      while (!pending.length) {
        if (port.closed) throw new Error('Port is not open');
        await new Promise<void>(resolve => {
          wake = resolve;
          setTimeout(resolve, 5);
        });
      }
      return Buffer.from(pending.shift()!, 'latin1');
    },
    async write(bytes: Uint8Array) {
      port.writes.push(...bytes);
      const answer = reply(bytes[0]!);
      if (answer !== null) pending.push(answer);
      wake?.();
    },
    async close() {
      port.closed = true;
    },
  };
  return port;
}

describe('scale frames', () => {
  it('reads Toledo, ECR and continuous weights in kilograms', () => {
    assert.deepEqual(parseScaleFrame('\x0200.385'), {
      kind: 'weight',
      kilograms: 0.385,
      stable: null,
    });
    assert.deepEqual(parseScaleFrame('\x0200385'), {
      kind: 'weight',
      kilograms: 0.385,
      stable: null,
    });
    assert.deepEqual(parseScaleFrame('ST,GS,+  0.250kg'), {
      kind: 'weight',
      kilograms: 0.25,
      stable: true,
    });
    assert.deepEqual(parseScaleFrame('US,GS,+  0.255kg'), {
      kind: 'weight',
      kilograms: 0.255,
      stable: false,
    });
    assert.deepEqual(parseScaleFrame('  1250 g'), {
      kind: 'weight',
      kilograms: 1.25,
      stable: null,
    });
    assert.deepEqual(parseScaleFrame('0,750 kg'), {
      kind: 'weight',
      kilograms: 0.75,
      stable: null,
    });
  });

  it('reports motion, overload, negative and pounds instead of a weight', () => {
    assert.deepEqual(parseScaleFrame('\x02?\x01'), { kind: 'unstable' });
    assert.deepEqual(parseScaleFrame('\x02?\x02'), { kind: 'overload' });
    assert.deepEqual(parseScaleFrame('\x02?\x04'), { kind: 'negative' });
    assert.deepEqual(parseScaleFrame('\x02?\x30'), { kind: 'empty' });
    assert.deepEqual(parseScaleFrame('\x02?\x31'), { kind: 'unstable' });
    assert.deepEqual(parseScaleFrame('OL,GS,+ 99.999kg'), { kind: 'overload' });
    assert.deepEqual(parseScaleFrame('ST,GS,-  0.010kg'), { kind: 'negative' });
    assert.deepEqual(parseScaleFrame('ST,GS,+  0.84lb'), { kind: 'unit' });
    assert.equal(parseScaleFrame('ST,GS'), null);
  });

  it('splits on CR, LF and ETX and keeps the unfinished tail', () => {
    assert.deepEqual(splitFrames('\x020.100\r\x020.2'), { frames: ['\x020.100'], rest: '\x020.2' });
    assert.deepEqual(splitFrames('a\x03b\r\n'), { frames: ['a', 'b'], rest: '' });
  });

  it('accepts only complete configurations with known values', () => {
    assert.equal(isScaleConfig(config), true);
    assert.equal(isScaleConfig({ ...config, baudRate: 1200 }), false);
    assert.equal(isScaleConfig({ ...config, path: 'COM3\n' }), false);
    assert.equal(isScaleConfig({ ...config, extra: true }), false);
  });
});

describe('reading a scale', () => {
  it('polls a Toledo scale with W until it stops moving', async () => {
    let polls = 0;
    const port = fakePort(poll => {
      assert.equal(poll, 0x57);
      polls += 1;
      return polls < 3 ? '\x02?\x01\r' : '\x0200.385\r';
    });
    const result = await readScaleWeight({ ...config, protocol: 'toledo' }, async () => port, {
      pollIntervalMs: 10,
    });
    assert.deepEqual(result, { status: 'ok', kilograms: 0.385 });
    assert.equal(port.closed, true);
  });

  it('sends ENQ for polled ECR scales', async () => {
    const port = fakePort(poll => (poll === 0x05 ? '\x020.500\x03' : null));
    const result = await readScaleWeight({ ...config, protocol: 'enq' }, async () => port);
    assert.deepEqual(result, { status: 'ok', kilograms: 0.5 });
    assert.deepEqual(port.writes, [0x05]);
  });

  it('waits for two matching frames when a stream has no stability flag', async () => {
    const port = fakePort(() => null, ['0.40', '1 kg\r', '0.420 kg\r', '0.4', '20 kg\r']);
    assert.deepEqual(await readScaleWeight(config, async () => port), {
      status: 'ok',
      kilograms: 0.42,
    });
    assert.deepEqual(port.writes, []);
  });

  it('returns why it gave up: motion, empty pan, silence or a missing port', async () => {
    const moving = fakePort(() => null, ['US,GS,+  0.300kg\r'.repeat(3)]);
    assert.deepEqual(await readScaleWeight(config, async () => moving, { timeoutMs: 60 }), {
      status: 'error',
      code: 'SCALE_UNSTABLE',
    });
    const empty = fakePort(() => null, ['ST,GS,+  0.000kg\r']);
    assert.deepEqual(await readScaleWeight(config, async () => empty), {
      status: 'error',
      code: 'SCALE_EMPTY',
    });
    const silent = fakePort(() => null);
    assert.deepEqual(await readScaleWeight(config, async () => silent, { timeoutMs: 40 }), {
      status: 'error',
      code: 'SCALE_NO_RESPONSE',
    });
    assert.equal(silent.closed, true);
    assert.deepEqual(
      await readScaleWeight(config, async () => {
        throw new ScaleOpenError('SCALE_BUSY');
      }),
      { status: 'error', code: 'SCALE_BUSY' }
    );
    assert.deepEqual(
      await readScaleWeight(config, async () => {
        throw new Error('boom');
      }),
      { status: 'error', code: 'SCALE_DISCONNECTED' }
    );
  });

  it('maps native open failures to busy or disconnected', () => {
    const errno = (code: string, message = '') => Object.assign(new Error(message), { code });
    assert.equal(openErrorCode(errno('ENOENT', 'No such file')), 'SCALE_DISCONNECTED');
    assert.equal(openErrorCode(errno('EACCES')), 'SCALE_BUSY');
    assert.equal(
      openErrorCode(new Error('Resource temporarily unavailable Cannot lock port')),
      'SCALE_BUSY'
    );
    assert.equal(openErrorCode(new Error('Opening COM3: Access is denied.')), 'SCALE_BUSY');
    assert.equal(openErrorCode(new Error('Opening COM3: Access denied')), 'SCALE_BUSY');
    assert.equal(
      openErrorCode(new Error('Error: Resource busy, cannot open /dev/tty.usbserial-1')),
      'SCALE_BUSY'
    );
    assert.equal(openErrorCode(new Error('Opening COM3: File not found')), 'SCALE_DISCONNECTED');
  });
});

function fixture(): ScaleDependencies & { stored: ScaleConfig | null; reads: ScaleConfig[] } {
  const deps = {
    stored: null as ScaleConfig | null,
    reads: [] as ScaleConfig[],
    session: { requireTenantId: () => 'tenant-a', requireOneOfRoles: () => 'admin' },
    captureSession: () => () => {},
    driverAvailable: async () => true,
    listPorts: async () => [{ path: config.path, label: 'FTDI (/dev/tty.usbserial-1)' }],
    read: async () => deps.stored,
    write: async (_tenantId: string, next: ScaleConfig | null) => {
      deps.stored = next;
    },
    readWeight: async (next: ScaleConfig) => {
      deps.reads.push(next);
      return { status: 'ok' as const, kilograms: 0.385 };
    },
  };
  return deps;
}

describe('scale IPC boundary', () => {
  it('saves only an enumerated port and reads from the saved selection', async () => {
    const deps = fixture();
    assert.deepEqual(await getScaleStatus(deps), { configured: false });
    assert.deepEqual(await readScale(deps), { status: 'error', code: 'SCALE_NOT_CONFIGURED' });
    assert.deepEqual(await saveScaleSettings({ ...config, path: '/dev/disk0' }, deps), {
      status: 'error',
      code: 'SCALE_PORT_UNAVAILABLE',
    });
    assert.deepEqual(await saveScaleSettings({ path: config.path }, deps), {
      status: 'error',
      code: 'SCALE_INVALID_CONFIG',
    });
    const saved = await saveScaleSettings(config, deps);
    assert.equal(saved.status === 'saved' && saved.settings.config, config);
    assert.deepEqual(await getScaleStatus(deps), { configured: true });
    assert.deepEqual(await readScale(deps), { status: 'ok', kilograms: 0.385 });
    assert.deepEqual(deps.reads, [config]);
    const cleared = await saveScaleSettings(null, deps);
    assert.equal(cleared.status === 'saved' && cleared.settings.config, null);
  });

  it('tests a draft without saving it and reports a port that went away', async () => {
    const deps = fixture();
    assert.deepEqual(await testScale(config, deps), { status: 'ok', kilograms: 0.385 });
    assert.equal(deps.stored, null);
    assert.deepEqual(await testScale({ ...config, path: '/dev/tty.gone' }, deps), {
      status: 'error',
      code: 'SCALE_DISCONNECTED',
    });
    assert.equal(deps.reads.length, 1);
  });

  it('reports a missing native driver without touching ports', async () => {
    const deps = fixture();
    deps.stored = config;
    deps.driverAvailable = async () => false;
    deps.listPorts = async () => assert.fail('must not enumerate');
    assert.deepEqual(await getScaleStatus(deps), { configured: false });
    assert.deepEqual(await readScale(deps), { status: 'error', code: 'SCALE_DRIVER_UNAVAILABLE' });
    assert.deepEqual(await getScaleSettings(deps), { available: false, ports: [], config });
  });

  it('authorizes before any port access and limits settings to admins and managers', async () => {
    const deps = fixture();
    let touched = 0;
    deps.listPorts = async () => {
      touched += 1;
      return [];
    };
    deps.readWeight = async () => {
      touched += 1;
      return { status: 'ok', kilograms: 1 };
    };
    deps.session.requireTenantId = () => {
      throw new Error('SESSION_NOT_REGISTERED');
    };
    await assert.rejects(() => readScale(deps), /SESSION_NOT_REGISTERED/);
    await assert.rejects(() => getScaleSettings(deps), /SESSION_NOT_REGISTERED/);
    deps.session.requireTenantId = () => 'tenant-a';
    deps.session.requireOneOfRoles = () => {
      throw new Error('SESSION_ROLE_FORBIDDEN');
    };
    await assert.rejects(() => getScaleSettings(deps), /SESSION_ROLE_FORBIDDEN/);
    await assert.rejects(() => saveScaleSettings(config, deps), /SESSION_ROLE_FORBIDDEN/);
    await assert.rejects(() => testScale(config, deps), /SESSION_ROLE_FORBIDDEN/);
    assert.equal(touched, 0);
    deps.stored = config;
    assert.deepEqual(await readScale(deps), { status: 'ok', kilograms: 1 });
  });
});

describe('scale preferences', () => {
  it('stores one private file per tenant and clears it on null', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'puntovivo-scale-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const preferences = createScalePreferences(directory);
    assert.equal(await preferences.read('tenant-a'), null);
    await preferences.write('tenant-a', config);
    assert.deepEqual(await preferences.read('tenant-a'), config);
    assert.equal(await preferences.read('tenant-b'), null);
    await preferences.write('tenant-a', null);
    assert.equal(await preferences.read('tenant-a'), null);
    assert.equal((await readdir(directory)).length, 1);
  });
});
