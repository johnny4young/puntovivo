/** Authenticated system-printer IPC core, kept Electron-free for authorization and race tests. */
import {
  isPrinterName,
  SystemPrinterError,
  type SystemPrinter,
} from '../system-printer-selection.ts';
import type { DesktopSessionAuthorizer } from './session-authorization.ts';

/** Host operations are injected; callers cannot supply identity or arbitrary device configuration. */
export interface SystemPrinterDependencies {
  session: DesktopSessionAuthorizer;
  captureSession: () => () => void;
  list: () => Promise<SystemPrinter[]>;
  read: (tenantId: string) => Promise<string | null>;
  write: (tenantId: string, name: string | null) => Promise<void>;
}

export async function listSystemPrinters(deps: SystemPrinterDependencies) {
  const tenantId = deps.session.requireTenantId();
  const assertSession = deps.captureSession();
  const printers = (await deps.list()).filter(printer => isPrinterName(printer.name));
  assertSession();
  const selectedDeviceName = await deps.read(tenantId);
  assertSession();
  if (deps.session.requireTenantId() !== tenantId) throw new Error('SESSION_NOT_REGISTERED');
  return { printers, selectedDeviceName };
}

export async function selectSystemPrinter(name: unknown, deps: SystemPrinterDependencies) {
  const tenantId = deps.session.requireTenantId();
  const assertSession = deps.captureSession();
  deps.session.requireOneOfRoles(['admin', 'manager']);
  if (name !== null && !isPrinterName(name))
    throw new SystemPrinterError('PRINT_INVALID_PRINTER', 'print.invalidPrinter');
  const state = await listSystemPrinters(deps);
  assertSession();
  if (name !== null && !state.printers.some(printer => printer.name === name))
    throw new SystemPrinterError('PRINT_PRINTER_UNAVAILABLE', 'print.printerUnavailable');
  if (deps.session.requireTenantId() !== tenantId) throw new Error('SESSION_NOT_REGISTERED');
  deps.session.requireOneOfRoles(['admin', 'manager']);
  await deps.write(tenantId, name);
  assertSession();
  return { ...state, selectedDeviceName: name };
}
