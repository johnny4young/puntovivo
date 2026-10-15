import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSystemPrinterPreferences,
  resolveSystemPrinter,
  isPrinterName,
  SystemPrinterError,
} from '../system-printer-selection.ts';
import {
  listSystemPrinters,
  selectSystemPrinter,
  type SystemPrinterDependencies,
} from '../ipc/system-printers.ts';

const printers = [
  { name: 'OS_queue_1', displayName: 'First', isDefault: true, status: 0 },
  { name: 'OS_queue_2', displayName: 'Second', isDefault: false, status: 0 },
];
function fixture(): SystemPrinterDependencies {
  return {
    captureSession: () => () => {},
    session: { requireTenantId: () => 'tenant-a', requireOneOfRoles: () => 'admin' },
    list: async () => printers,
    read: async () => null,
    write: async () => {},
  };
}

describe('local system printer boundary', () => {
  it('selects a non-default OS name and never confuses it with a friendly name', async () => {
    const deps = fixture();
    const writes: unknown[] = [];
    deps.write = async (...args) => {
      writes.push(args);
    };
    assert.equal((await selectSystemPrinter('OS_queue_2', deps)).selectedDeviceName, 'OS_queue_2');
    assert.deepEqual(writes, [['tenant-a', 'OS_queue_2']]);
    assert.deepEqual(resolveSystemPrinter(printers, 'OS_queue_2', true), {
      deviceName: 'OS_queue_2',
      silent: true,
    });
    await assert.rejects(() => selectSystemPrinter('Second', deps), SystemPrinterError);
  });
  it('opens a dialog for legacy profiles even if their silent preference was enabled', () => {
    assert.deepEqual(resolveSystemPrinter(printers, null, true), { silent: false });
    assert.deepEqual(resolveSystemPrinter(printers, 'OS_queue_2', false), {
      deviceName: 'OS_queue_2',
      silent: false,
    });
  });
  it('does not reroute a disconnected selection to the default and detects empty queues', () => {
    assert.throws(() => resolveSystemPrinter(printers.slice(0, 1), 'OS_queue_2', true), {
      code: 'PRINT_PRINTER_UNAVAILABLE',
    });
    assert.throws(() => resolveSystemPrinter([], null, false), { code: 'PRINT_NO_PRINTERS' });
  });
  it('authorizes before enumeration or persistence and enforces selection roles', async () => {
    const deps = fixture();
    let calls = 0;
    deps.list = async () => {
      calls++;
      return printers;
    };
    deps.write = async () => {
      calls++;
    };
    deps.session.requireTenantId = () => {
      throw new Error('SESSION_NOT_REGISTERED');
    };
    await assert.rejects(() => listSystemPrinters(deps), /SESSION_NOT_REGISTERED/);
    await assert.rejects(() => selectSystemPrinter(null, deps), /SESSION_NOT_REGISTERED/);
    assert.equal(calls, 0);
    deps.session.requireTenantId = () => 'tenant-a';
    deps.session.requireOneOfRoles = () => {
      throw new Error('SESSION_ROLE_FORBIDDEN');
    };
    await assert.rejects(() => selectSystemPrinter('OS_queue_2', deps), /SESSION_ROLE_FORBIDDEN/);
    assert.equal(calls, 0);
  });
  it('rejects malformed renderer input without enumeration', async () => {
    const deps = fixture();
    let calls = 0;
    deps.list = async () => {
      calls++;
      return printers;
    };
    for (const value of ['', {}, ['OS_queue_1'], 'evil\nqueue', 'x'.repeat(513)])
      await assert.rejects(() => selectSystemPrinter(value, deps), SystemPrinterError);
    assert.equal(calls, 0);
    assert.equal(isPrinterName('Impresora Caja 2'), true);
  });
  it('rejects a tenant change during enumeration without returning or storing a selection', async () => {
    const deps = fixture();
    let tenant = 'tenant-a';
    let wrote = false;
    deps.session.requireTenantId = () => tenant;
    deps.list = async () => {
      tenant = 'tenant-b';
      return printers;
    };
    deps.write = async () => {
      wrote = true;
    };
    await assert.rejects(() => selectSystemPrinter('OS_queue_2', deps), /SESSION_NOT_REGISTERED/);
    assert.equal(wrote, false);
  });
  it('persists per tenant and survives recreation without modifying another selection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'printer-prefs-'));
    try {
      const store = createSystemPrinterPreferences(directory);
      assert.equal(await store.read('tenant-a'), null);
      await store.write('tenant-a', 'OS_queue_2');
      await store.write('tenant-b', 'OS_queue_1');
      const restored = createSystemPrinterPreferences(directory);
      assert.equal(await restored.read('tenant-a'), 'OS_queue_2');
      assert.equal(await restored.read('tenant-b'), 'OS_queue_1');
      await restored.write('tenant-a', null);
      assert.equal(await restored.read('tenant-a'), null);
      assert.equal(await restored.read('tenant-b'), 'OS_queue_1');
      assert.equal((await readdir(directory)).length, 2);
      assert.match(
        await readFile(join(directory, (await readdir(directory))[0]!), 'utf8'),
        /deviceName/
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rechecks selection role after enumeration even within the same tenant', async () => {
    const deps = fixture();
    let role = 'admin';
    let wrote = false;
    deps.session.requireOneOfRoles = () => {
      if (role !== 'admin') throw new Error('SESSION_ROLE_FORBIDDEN');
      return role;
    };
    deps.list = async () => {
      role = 'cashier';
      return printers;
    };
    deps.write = async () => {
      wrote = true;
    };
    await assert.rejects(() => selectSystemPrinter('OS_queue_2', deps), /SESSION_ROLE_FORBIDDEN/);
    assert.equal(wrote, false);
  });
  it('rejects an ABA session guard before writing a selection', async () => {
    const deps = fixture();
    let revision = 1;
    let wrote = false;
    deps.captureSession = () => {
      const expected = revision;
      return () => {
        if (revision !== expected) throw new Error('SESSION_NOT_REGISTERED');
      };
    };
    deps.list = async () => {
      revision += 2;
      return printers;
    };
    deps.write = async () => {
      wrote = true;
    };
    await assert.rejects(() => selectSystemPrinter('OS_queue_2', deps), /SESSION_NOT_REGISTERED/);
    assert.equal(wrote, false);
  });
});
