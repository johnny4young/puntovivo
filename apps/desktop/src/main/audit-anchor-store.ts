/** Device-local safeStorage persistence for audit-chain freshness anchors. */
import type {
  AuditAnchorPoint,
  AuditAnchorStore,
  AuditAnchorTenantEnvelope,
} from '@puntovivo/server/audit-anchor';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { assertSafeStorageUsable, type SafeStorageLike } from './db-key-store.ts';

export const AUDIT_ANCHOR_STATE_FILE = '.audit-anchor-state.enc';
const ROOT_VERSION = 1 as const;

export function getAuditAnchorStatePath(dataDir: string): string {
  return join(dataDir, AUDIT_ANCHOR_STATE_FILE);
}

interface AuditAnchorRootEnvelope {
  version: typeof ROOT_VERSION;
  tenants: Record<string, AuditAnchorTenantEnvelope>;
}

export interface DesktopAuditAnchorStore extends AuditAnchorStore {
  replaceAll(points: ReadonlyArray<{ tenantId: string } & AuditAnchorPoint>): void;
}

function emptyEnvelope(): AuditAnchorRootEnvelope {
  return {
    version: ROOT_VERSION,
    tenants: Object.create(null) as Record<string, AuditAnchorTenantEnvelope>,
  };
}

export function createSafeStorageAuditAnchorStore(options: {
  dataDir: string;
  safeStorage: SafeStorageLike;
  platform?: NodeJS.Platform;
}): DesktopAuditAnchorStore {
  const { dataDir, safeStorage, platform = process.platform } = options;
  assertSafeStorageUsable(safeStorage, platform);
  const statePath = getAuditAnchorStatePath(dataDir);

  function readRoot(): AuditAnchorRootEnvelope {
    if (!existsSync(statePath)) return emptyEnvelope();
    let parsed: unknown;
    try {
      parsed = JSON.parse(safeStorage.decryptString(readFileSync(statePath)));
    } catch (error) {
      throw new Error('AUDIT_ANCHOR_STATE_DECRYPT_FAILED', { cause: error });
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== ROOT_VERSION ||
      typeof (parsed as { tenants?: unknown }).tenants !== 'object' ||
      (parsed as { tenants?: unknown }).tenants === null ||
      Array.isArray((parsed as { tenants?: unknown }).tenants)
    ) {
      throw new Error('AUDIT_ANCHOR_STATE_INVALID');
    }
    const tenants = Object.create(null) as Record<string, AuditAnchorTenantEnvelope>;
    for (const [tenantId, envelope] of Object.entries(
      (parsed as { tenants: Record<string, AuditAnchorTenantEnvelope> }).tenants
    )) {
      tenants[tenantId] = envelope;
    }
    return { version: ROOT_VERSION, tenants };
  }

  function writeRoot(root: AuditAnchorRootEnvelope): void {
    mkdirSync(dirname(statePath), { recursive: true });
    const tmpPath = `${statePath}.tmp`;
    try {
      unlinkSync(tmpPath);
    } catch {
      // absent
    }
    const sealed = safeStorage.encryptString(JSON.stringify(root));
    writeFileSync(tmpPath, sealed, { flag: 'wx', mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // Windows ACLs plus DPAPI own access control.
    }
    const file = openSync(tmpPath, 'r');
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    try {
      renameSync(tmpPath, statePath);
    } catch (error) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // preserve the rename failure
      }
      throw error;
    }
    if (platform !== 'win32') {
      const directory = openSync(dirname(statePath), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  }

  return {
    read(tenantId) {
      return readRoot().tenants[tenantId] ?? null;
    },
    write(tenantId, envelope) {
      const root = readRoot();
      root.tenants[tenantId] = envelope;
      writeRoot(root);
    },
    replaceAll(points) {
      const root = emptyEnvelope();
      for (const point of points) {
        root.tenants[point.tenantId] = {
          version: 1,
          confirmed: { counter: point.counter, headHash: point.headHash },
          pending: null,
        };
      }
      writeRoot(root);
    },
  };
}
