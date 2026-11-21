/** Native serial access through @serialport/bindings-cpp, loaded only when a scale is used. */
import { framingOptions, isScalePath, type ScaleConfig, type ScaleErrorCode } from './protocol.ts';
import type { OpenScalePort } from './reader.ts';

export interface SerialPortSummary {
  path: string;
  label: string;
}

// The subset of the binding contract this reader uses.
interface SerialBinding {
  list: () => Promise<Array<{ path: string; manufacturer?: string | undefined }>>;
  open: (options: {
    path: string;
    baudRate: number;
    dataBits: 7 | 8;
    parity: 'none' | 'even';
    stopBits: 1;
  }) => Promise<{
    isOpen: boolean;
    read: (
      buffer: Buffer,
      offset: number,
      length: number
    ) => Promise<{ buffer: Buffer; bytesRead: number }>;
    write: (buffer: Buffer) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

let binding: Promise<SerialBinding | null> | null = null;
let reportLoadError: (error: unknown) => void = () => {};

/** Where a failed addon load is reported; the failure is cached for the session. */
export function onSerialBindingLoadError(report: (error: unknown) => void): void {
  reportLoadError = report;
}

/** Null when the native addon is missing for this platform; typed weight keeps working. */
export function loadSerialBinding(): Promise<SerialBinding | null> {
  binding ??= import('@serialport/bindings-cpp')
    .then((module): SerialBinding => module.autoDetect())
    .catch((error: unknown) => {
      reportLoadError(error);
      return null;
    });
  return binding;
}

export async function listSerialPorts(): Promise<SerialPortSummary[]> {
  const native = await loadSerialBinding();
  if (!native) return [];
  const ports = await native.list();
  return ports
    .filter(port => isScalePath(port.path))
    .map(port => ({
      path: port.path,
      label: port.manufacturer ? `${port.manufacturer} (${port.path})` : port.path,
    }));
}

const READ_CHUNK = 64;

/** Open failure carrying the code the cashier sees. */
export class ScaleOpenError extends Error {
  readonly code: ScaleErrorCode;
  constructor(code: ScaleErrorCode) {
    super(code);
    this.code = code;
  }
}

export function openErrorCode(error: unknown): ScaleErrorCode {
  const errno = (error as NodeJS.ErrnoException | undefined)?.code ?? '';
  const message = error instanceof Error ? error.message : '';
  return /EBUSY|EACCES|EPERM/.test(errno) ||
    /lock|busy|Access (is )?denied|Permission denied/i.test(message)
    ? 'SCALE_BUSY'
    : 'SCALE_DISCONNECTED';
}

export const openSerialScalePort: OpenScalePort = async (config: ScaleConfig) => {
  const native = await loadSerialBinding();
  if (!native) throw new ScaleOpenError('SCALE_DRIVER_UNAVAILABLE');
  let port: Awaited<ReturnType<SerialBinding['open']>>;
  try {
    port = await native.open({
      path: config.path,
      baudRate: config.baudRate,
      ...framingOptions(config.framing),
    });
  } catch (error) {
    throw new ScaleOpenError(openErrorCode(error));
  }
  // The native poller settles its promises outside a microtask checkpoint; a
  // timer tick while the port is open lets reads continue without other work.
  const tick = setInterval(() => {}, 20);
  return {
    read: async () => {
      const { buffer, bytesRead } = await port.read(Buffer.alloc(READ_CHUNK), 0, READ_CHUNK);
      return buffer.subarray(0, bytesRead);
    },
    write: bytes => port.write(Buffer.from(bytes)),
    close: () => {
      clearInterval(tick);
      return port.isOpen ? port.close() : Promise.resolve();
    },
  };
};
