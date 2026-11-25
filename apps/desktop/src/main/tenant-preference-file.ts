/** One private JSON file per tenant on this installation, outside synchronized app settings. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createTenantPreferenceFile<T>(
  directory: string,
  prefix: string,
  parse: (value: unknown) => T | null
) {
  function pathFor(tenantId: string) {
    return join(directory, `${prefix}-${createHash('sha256').update(tenantId).digest('hex')}.json`);
  }
  return {
    async read(tenantId: string): Promise<T | null> {
      try {
        return parse(JSON.parse(await readFile(pathFor(tenantId), 'utf8')));
      } catch (error) {
        if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
          return null;
        throw error;
      }
    },
    /** Atomic replace, so a crash never leaves a half-written selection. */
    async write(tenantId: string, value: unknown): Promise<void> {
      await mkdir(directory, { recursive: true });
      const destination = pathFor(tenantId);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
