/** Authenticated scale IPC core, kept Electron-free for authorization and validation tests. */
import { isScaleConfig, type ScaleConfig, type ScaleReadResult } from '../scale/protocol.ts';
import type { SerialPortSummary } from '../scale/serial-port.ts';
import type { DesktopSessionAuthorizer } from './session-authorization.ts';

const SETTINGS_ROLES = ['admin', 'manager'] as const;
export const MAX_PENDING_SCALE_READS = 4;

/** Serialize serial-port reads and reject excess clicks while a read is stalled. */
export function createBoundedScaleReadQueue(
  runRead: (config: ScaleConfig) => Promise<ScaleReadResult>,
  maxPending = MAX_PENDING_SCALE_READS
): (config: ScaleConfig) => Promise<ScaleReadResult> {
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return (config: ScaleConfig): Promise<ScaleReadResult> => {
    if (pending >= maxPending) {
      return Promise.resolve({ status: 'error', code: 'SCALE_BUSY' });
    }
    pending += 1;
    const next = queue
      .then(() => runRead(config))
      .finally(() => {
        pending -= 1;
      });
    queue = next.catch(() => {});
    return next;
  };
}

export interface ScaleDependencies {
  session: DesktopSessionAuthorizer;
  captureSession: () => () => void;
  driverAvailable: () => Promise<boolean>;
  listPorts: () => Promise<SerialPortSummary[]>;
  read: (tenantId: string) => Promise<ScaleConfig | null>;
  write: (tenantId: string, config: ScaleConfig | null) => Promise<void>;
  readWeight: (config: ScaleConfig) => Promise<ScaleReadResult>;
}

export interface ScaleSettingsState {
  available: boolean;
  ports: SerialPortSummary[];
  config: ScaleConfig | null;
}

/** What the register needs: whether «Leer báscula» has anything to read. */
export async function getScaleStatus(deps: ScaleDependencies) {
  const tenantId = deps.session.requireTenantId();
  const config = await deps.read(tenantId);
  return { configured: config !== null && (await deps.driverAvailable()) };
}

export async function getScaleSettings(deps: ScaleDependencies): Promise<ScaleSettingsState> {
  const tenantId = deps.session.requireTenantId();
  deps.session.requireOneOfRoles(SETTINGS_ROLES);
  const assertSession = deps.captureSession();
  const [available, config] = await Promise.all([deps.driverAvailable(), deps.read(tenantId)]);
  const ports = available ? await deps.listPorts() : [];
  assertSession();
  return { available, ports, config };
}

// The renderer may only point the main process at a port the OS enumerated.
async function isListedPort(path: string, deps: ScaleDependencies) {
  return (await deps.listPorts()).some(port => port.path === path);
}

export type ScaleSaveResult =
  | { status: 'saved'; settings: ScaleSettingsState }
  | { status: 'error'; code: 'SCALE_INVALID_CONFIG' | 'SCALE_PORT_UNAVAILABLE' };

// Rejections come back as results: Electron logs every handler that throws.
export async function saveScaleSettings(
  config: unknown,
  deps: ScaleDependencies
): Promise<ScaleSaveResult> {
  const tenantId = deps.session.requireTenantId();
  deps.session.requireOneOfRoles(SETTINGS_ROLES);
  const assertSession = deps.captureSession();
  if (config !== null && !isScaleConfig(config))
    return { status: 'error', code: 'SCALE_INVALID_CONFIG' };
  const ports = await deps.listPorts();
  if (config !== null && !ports.some(port => port.path === config.path))
    return { status: 'error', code: 'SCALE_PORT_UNAVAILABLE' };
  assertSession();
  await deps.write(tenantId, config);
  return { status: 'saved', settings: { available: await deps.driverAvailable(), ports, config } };
}

/** Reads a draft configuration before it is saved; never stores it. */
export async function testScale(
  config: unknown,
  deps: ScaleDependencies
): Promise<ScaleReadResult> {
  deps.session.requireTenantId();
  deps.session.requireOneOfRoles(SETTINGS_ROLES);
  if (!(await deps.driverAvailable())) return { status: 'error', code: 'SCALE_DRIVER_UNAVAILABLE' };
  const assertSession = deps.captureSession();
  if (!isScaleConfig(config)) return { status: 'error', code: 'SCALE_NOT_CONFIGURED' };
  if (!(await isListedPort(config.path, deps)))
    return { status: 'error', code: 'SCALE_DISCONNECTED' };
  assertSession();
  return deps.readWeight(config);
}

/** Any signed-in role weighs; the port comes only from this device's saved selection. */
export async function readScale(deps: ScaleDependencies): Promise<ScaleReadResult> {
  const tenantId = deps.session.requireTenantId();
  const config = await deps.read(tenantId);
  if (!config) return { status: 'error', code: 'SCALE_NOT_CONFIGURED' };
  if (!(await deps.driverAvailable())) return { status: 'error', code: 'SCALE_DRIVER_UNAVAILABLE' };
  return deps.readWeight(config);
}
