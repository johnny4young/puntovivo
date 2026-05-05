/**
 * ENG-062 — EscPosReceiptPrinterAdapter + EscPosCashDrawerAdapter tests.
 *
 * Drives the adapters through the in-memory `MockEscPosTransport`
 * via the `__setEscPosTransportForTest` seam so we can assert the
 * canonical bytes (init + cut + drawer pulse) without a physical
 * printer. Transport-failure paths use a stub transport that
 * throws `EscPosTransportError` to verify the adapter normalizes
 * the error to the discriminated union.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  EscPosCashDrawerAdapter,
  EscPosReceiptPrinterAdapter,
  EscPosTransportError,
  ESCPOS_BYTES,
  MockEscPosTransport,
  __setEscPosTransportForTest,
  escposCashDrawerConfigSchema,
  escposReceiptPrinterConfigSchema,
  type EscPosTransport,
  type ReceiptDocument,
} from '../services/peripherals/index.js';

const TENANT = 'tenant-test';
const SITE = 'site-test';
const PERIPHERAL = 'peripheral-test';

afterEach(() => {
  __setEscPosTransportForTest(null);
});

describe('EscPosReceiptPrinterAdapter', () => {
  it('builds bytes from job.metadata.document and writes via the transport', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({ channel: 'mock' })
    );
    const document: ReceiptDocument = {
      lines: [{ text: 'Hola POS', align: 'center', bold: true }],
      cut: true,
    };
    const result = await adapter.print({
      kind: 'sale-receipt',
      metadata: { document },
    });
    expect(result.status).toBe('ok');
    const buffer = mock.buffer();
    expect(buffer.subarray(0, 2)).toEqual(ESCPOS_BYTES.INIT);
    // Final 3 bytes are the full-cut command.
    expect(buffer.subarray(buffer.length - 3)).toEqual(ESCPOS_BYTES.CUT_FULL);
  });

  it('appends the drawer pulse on sale-receipt when kickDrawerAfterReceipt=true', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({
        channel: 'mock',
        kickDrawerAfterReceipt: true,
      })
    );
    await adapter.print({
      kind: 'sale-receipt',
      metadata: { document: { lines: [{ text: 'venta' }] } },
    });
    const buf = mock.buffer();
    // Drawer pulse should appear before the cut.
    const findIdx = (needle: Uint8Array) => {
      outer: for (let i = 0; i + needle.length <= buf.length; i += 1) {
        for (let j = 0; j < needle.length; j += 1) {
          if (buf[i + j] !== needle[j]) continue outer;
        }
        return i;
      }
      return -1;
    };
    const kickIdx = findIdx(ESCPOS_BYTES.DRAWER_KICK);
    const cutIdx = findIdx(ESCPOS_BYTES.CUT_FULL);
    expect(kickIdx).toBeGreaterThan(0);
    expect(cutIdx).toBeGreaterThan(kickIdx);
  });

  it('skips the drawer pulse when kickDrawerAfterReceipt=false', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({
        channel: 'mock',
        kickDrawerAfterReceipt: false,
      })
    );
    await adapter.print({
      kind: 'sale-receipt',
      metadata: { document: { lines: [{ text: 'venta' }] } },
    });
    const buf = mock.buffer();
    const findIdx = (needle: Uint8Array) => {
      outer: for (let i = 0; i + needle.length <= buf.length; i += 1) {
        for (let j = 0; j < needle.length; j += 1) {
          if (buf[i + j] !== needle[j]) continue outer;
        }
        return i;
      }
      return -1;
    };
    expect(findIdx(ESCPOS_BYTES.DRAWER_KICK)).toBe(-1);
  });

  it('uses pre-built escposBytes when callers supply them directly', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({ channel: 'mock' })
    );
    const preBuilt = new Uint8Array([0x1b, 0x40, 0x48, 0x69, 0x0a, 0x1d, 0x56, 0x00]);
    const result = await adapter.print({ kind: 'sale-receipt', escposBytes: preBuilt });
    expect(result.status).toBe('ok');
    expect(mock.buffer()).toEqual(preBuilt);
  });

  it('returns a normalized DEVICE_OFFLINE error when the transport throws an offline cause', async () => {
    const failing: EscPosTransport = {
      async write() {
        throw new EscPosTransportError('connect refused', {
          kind: 'DEVICE_OFFLINE',
          message: 'Connection refused',
        });
      },
      async close() {},
    };
    __setEscPosTransportForTest(failing);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({ channel: 'tcp', host: '127.0.0.1' })
    );
    const result = await adapter.print({
      kind: 'sale-receipt',
      metadata: { document: { lines: [{ text: 'venta' }] } },
    });
    expect(result.status).toBe('error');
    expect(result.error?.kind).toBe('DEVICE_OFFLINE');
  });

  it('rejects a job that supplies neither escposBytes nor metadata.document', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({ channel: 'mock' })
    );
    const result = await adapter.print({ kind: 'sale-receipt' });
    expect(result.status).toBe('error');
    expect(result.error?.kind).toBe('INVALID_CONFIG');
  });

  it('testPrint writes a banner to the transport', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosReceiptPrinterAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposReceiptPrinterConfigSchema.parse({ channel: 'mock' })
    );
    const result = await adapter.testPrint();
    expect(result.status).toBe('ok');
    expect(mock.captured.length).toBeGreaterThan(0);
  });
});

describe('EscPosCashDrawerAdapter', () => {
  it('writes the canonical drawer pulse via the transport', async () => {
    const mock = new MockEscPosTransport();
    __setEscPosTransportForTest(mock);
    const adapter = new EscPosCashDrawerAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposCashDrawerConfigSchema.parse({ channel: 'mock' })
    );
    const result = await adapter.kick();
    expect(result.status).toBe('ok');
    expect(mock.buffer()).toEqual(ESCPOS_BYTES.DRAWER_KICK);
  });

  it('returns a normalized error when the transport refuses to write', async () => {
    const failing: EscPosTransport = {
      async write() {
        throw new EscPosTransportError('USB unplugged', {
          kind: 'DEVICE_OFFLINE',
          message: 'USB unplugged',
        });
      },
      async close() {},
    };
    __setEscPosTransportForTest(failing);
    const adapter = new EscPosCashDrawerAdapter(
      TENANT,
      SITE,
      PERIPHERAL,
      escposCashDrawerConfigSchema.parse({ channel: 'usb' })
    );
    const result = await adapter.kick();
    expect(result.status).toBe('error');
    expect(result.error?.kind).toBe('DEVICE_OFFLINE');
  });
});
