/** Device-local system printer selection; never synchronized or taken from a peripheral display name. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Bounded public projection of Electron PrinterInfo, without driver-specific options. */
export interface SystemPrinter {
  name: string;
  displayName: string;
}

/** Main-process translation keys for stable device and spooler failures. */
export type SystemPrinterTranslationKey =
  | 'print.noSystemPrinters'
  | 'print.printerUnavailable'
  | 'print.invalidPrinter'
  | 'print.systemJobFailed'
  | 'print.systemTimeout';

export class SystemPrinterError extends Error {
  readonly code: string;
  readonly translationKey: SystemPrinterTranslationKey;
  constructor(code: string, translationKey: SystemPrinterTranslationKey) {
    super(translationKey);
    this.code = code;
    this.translationKey = translationKey;
    this.name = 'SystemPrinterError';
  }
}

export function isPrinterName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 512 &&
    ![...value].some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

/** Legacy profiles open a dialog; a missing explicit selection must never reroute silently. */
export function resolveSystemPrinter(
  printers: SystemPrinter[],
  selected: string | null,
  silent: boolean
): { deviceName?: string; silent: boolean } {
  if (printers.length === 0)
    throw new SystemPrinterError('PRINT_NO_PRINTERS', 'print.noSystemPrinters');
  if (selected !== null) {
    if (!printers.some(printer => printer.name === selected))
      throw new SystemPrinterError('PRINT_PRINTER_UNAVAILABLE', 'print.printerUnavailable');
    return { deviceName: selected, silent };
  }
  return { silent: false };
}

/** One atomic file per authenticated tenant on this installation, outside synchronized app_settings. */
export function createSystemPrinterPreferences(directory: string) {
  function pathFor(tenantId: string) {
    return join(
      directory,
      `receipt-printer-${createHash('sha256').update(tenantId).digest('hex')}.json`
    );
  }
  return {
    async read(tenantId: string): Promise<string | null> {
      try {
        const value: unknown = JSON.parse(await readFile(pathFor(tenantId), 'utf8'));
        if (
          value &&
          typeof value === 'object' &&
          'deviceName' in value &&
          isPrinterName(value.deviceName)
        )
          return value.deviceName;
        return null;
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
          return null;
        throw error;
      }
    },
    async write(tenantId: string, deviceName: unknown): Promise<void> {
      if (deviceName !== null && !isPrinterName(deviceName))
        throw new SystemPrinterError('PRINT_INVALID_PRINTER', 'print.invalidPrinter');
      await mkdir(directory, { recursive: true });
      const destination = pathFor(tenantId);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ deviceName }), { flag: 'wx', mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
