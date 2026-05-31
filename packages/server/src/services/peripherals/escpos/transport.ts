/**
 * ENG-062 — ESC/POS transport layer.
 *
 * Abstracts the byte-to-device write so the adapter can dispatch
 * over any of {USB, TCP, serial, mock} without ESC/POS-aware code
 * elsewhere in the stack.
 *
 * **ENG-062 ships Mock + TCP fully**. USB and Serial transports
 * lazy-load native modules (`node-thermal-printer`, `serialport`,
 * `usb`) which are NOT installed by default — the adapter
 * gracefully degrades to `NormalizedHardwareError` of kind
 * `DRIVER_NOT_IMPLEMENTED` when the operator registers a USB or
 * serial peripheral but the host environment lacks the bindings. A
 * follow-up ticket adds the native deps + the live USB/serial
 * implementations once a physical hardware lab is available.
 *
 * The Mock transport captures bytes into an in-memory buffer so
 * unit tests + the live Playwright MCP smoke can introspect what
 * the adapter sent without requiring a real printer.
 *
 * @module services/peripherals/escpos/transport
 */

import { Socket } from 'node:net';
import type { NormalizedHardwareError } from '../types.js';
import {
  EscPosTcpTargetPolicyError,
  resolveEscPosTcpTarget,
} from './tcp-target-policy.js';

// =============================================================================
// Public types
// =============================================================================

export type EscPosChannel = 'usb' | 'tcp' | 'serial' | 'mock';

// ENG-179b — explicit `| undefined` on every optional field so device
// drivers (`escpos-cash-drawer`, `escpos-receipt-printer`) can build
// the config by spreading nullable DB rows under
// `exactOptionalPropertyTypes`.
export interface EscPosTransportConfig {
  channel: EscPosChannel;
  host?: string | undefined;
  port?: number | undefined;
  vendorId?: number | undefined;
  productId?: number | undefined;
  devicePath?: string | undefined;
  /** Connect timeout in milliseconds. Defaults to 3000 ms. */
  timeoutMs?: number | undefined;
}

export interface EscPosTransport {
  /** Write a byte buffer to the device. Throws on transport failure. */
  write(bytes: Uint8Array): Promise<void>;
  /** Release any underlying handle. Safe to call multiple times. */
  close(): Promise<void>;
}

/**
 * Error subclass thrown by transports so the adapter can map raw
 * causes to `NormalizedHardwareError` discriminator + actionable
 * operator copy.
 */
export class EscPosTransportError extends Error {
  constructor(
    message: string,
    readonly normalized: NormalizedHardwareError
  ) {
    super(message);
    this.name = 'EscPosTransportError';
  }
}

// =============================================================================
// Mock transport
// =============================================================================

/**
 * In-memory transport. Captures every byte the adapter writes so
 * unit tests (and the Playwright MCP smoke) can assert the canonical
 * ESC/POS sequence without a physical printer.
 */
export class MockEscPosTransport implements EscPosTransport {
  /** All write() calls accumulate here in order. */
  readonly captured: Uint8Array[] = [];
  closed = false;

  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new EscPosTransportError('mock transport already closed', {
        kind: 'PROTOCOL_ERROR',
        message: 'Mock transport was closed before write',
      });
    }
    // Defensive copy so test mutations don't bleed back into the adapter buffer.
    this.captured.push(new Uint8Array(bytes));
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Concatenate every captured chunk into a single buffer for assertions. */
  buffer(): Uint8Array {
    let total = 0;
    for (const c of this.captured) total += c.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.captured) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
}

// =============================================================================
// TCP transport
// =============================================================================

/**
 * Raw TCP socket transport. The most common LAN-attached thermal
 * printer interface (Epson + Xprinter both ship a built-in NIC at
 * port 9100 by default).
 */
export class TcpEscPosTransport implements EscPosTransport {
  private socket: Socket | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 3000
  ) {}

  private async ensureConnected(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return this.socket;
    let target: Awaited<ReturnType<typeof resolveEscPosTcpTarget>>;
    try {
      target = await resolveEscPosTcpTarget(this.host, this.port);
    } catch (err) {
      if (err instanceof EscPosTcpTargetPolicyError) {
        throw new EscPosTransportError(err.message, {
          kind: 'INVALID_CONFIG',
          message: err.message,
          details: err.details,
        });
      }
      throw err;
    }
    return await new Promise<Socket>((resolve, reject) => {
      const socket = new Socket();
      const onError = (err: Error) => {
        socket.destroy();
        reject(
          new EscPosTransportError(`TCP connect to ${this.host}:${this.port} failed: ${err.message}`, {
            kind: 'DEVICE_OFFLINE',
            message: err.message,
            details: { host: this.host, port: this.port },
          })
        );
      };
      const timer = setTimeout(() => {
        socket.destroy();
        reject(
          new EscPosTransportError(`TCP connect to ${this.host}:${this.port} timed out`, {
            kind: 'DEVICE_TIMEOUT',
            message: 'Connect timed out',
            details: { host: this.host, port: this.port, timeoutMs: this.timeoutMs },
          })
        );
      }, this.timeoutMs);
      socket.once('error', onError);
      socket.connect({ host: target.host, port: this.port, family: target.family }, () => {
        clearTimeout(timer);
        socket.removeListener('error', onError);
        this.socket = socket;
        resolve(socket);
      });
    });
  }

  async write(bytes: Uint8Array): Promise<void> {
    const socket = await this.ensureConnected();
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.from(bytes), err => {
        if (err) {
          reject(
            new EscPosTransportError(`TCP write failed: ${err.message}`, {
              kind: 'PROTOCOL_ERROR',
              message: err.message,
            })
          );
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      await new Promise<void>(resolve => {
        this.socket!.end(() => resolve());
      });
    }
    this.socket = null;
  }
}

// =============================================================================
// USB / Serial stubs (deferred — no native deps in ENG-062)
// =============================================================================

/**
 * USB transport stub. Lazy-loads `node-thermal-printer` (or `usb`)
 * on first write; throws `DRIVER_NOT_IMPLEMENTED` if the binding
 * is not installed. A follow-up ticket replaces this with a real
 * implementation once the physical hardware lab is online and the
 * native deps are wired into the Electron rebuild step.
 */
export class UsbEscPosStubTransport implements EscPosTransport {
  async write(_bytes: Uint8Array): Promise<void> {
    throw new EscPosTransportError(
      'USB ESC/POS transport is not implemented yet — register the printer with channel=tcp or use channel=mock for tests',
      {
        kind: 'DRIVER_NOT_IMPLEMENTED',
        message: 'USB ESC/POS transport pending — register with channel=tcp or mock',
      }
    );
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

export class SerialEscPosStubTransport implements EscPosTransport {
  async write(_bytes: Uint8Array): Promise<void> {
    throw new EscPosTransportError(
      'Serial ESC/POS transport is not implemented yet — register the printer with channel=tcp or use channel=mock for tests',
      {
        kind: 'DRIVER_NOT_IMPLEMENTED',
        message: 'Serial ESC/POS transport pending — register with channel=tcp or mock',
      }
    );
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * ENG-062 test seam. When set, `resolveTransport` returns the
 * override regardless of `config.channel`. Tests inject a
 * `MockEscPosTransport` and assert against `captured` after the
 * adapter fires.
 */
let TEST_TRANSPORT_OVERRIDE: EscPosTransport | null = null;

export function __setEscPosTransportForTest(transport: EscPosTransport | null): void {
  TEST_TRANSPORT_OVERRIDE = transport;
}

/**
 * Build a transport from the persisted config. TCP requires an
 * explicit private-LAN host and defaults only the raw-print port
 * to `9100` (Epson + Xprinter LAN default).
 */
export function resolveTransport(config: EscPosTransportConfig): EscPosTransport {
  if (TEST_TRANSPORT_OVERRIDE) return TEST_TRANSPORT_OVERRIDE;

  switch (config.channel) {
    case 'mock':
      return new MockEscPosTransport();
    case 'tcp': {
      const host = config.host?.trim();
      if (!host) {
        throw new EscPosTransportError('ESC/POS TCP host is required', {
          kind: 'INVALID_CONFIG',
          message: 'ESC/POS TCP host is required',
        });
      }
      const port = config.port ?? 9100;
      return new TcpEscPosTransport(host, port, config.timeoutMs);
    }
    case 'usb':
      return new UsbEscPosStubTransport();
    case 'serial':
      return new SerialEscPosStubTransport();
    default:
      throw new EscPosTransportError(`Unknown ESC/POS channel: ${config.channel}`, {
        kind: 'INVALID_CONFIG',
        message: `Unknown ESC/POS channel: ${config.channel}`,
      });
  }
}
