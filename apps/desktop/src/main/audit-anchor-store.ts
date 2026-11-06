/** Device-local persistence for audit-chain freshness anchors. */
import {
  AUDIT_ANCHOR_ENVELOPE_VERSION,
  type AuditAnchorPoint,
  type AuditAnchorStore,
  type AuditAnchorStoredTenantEnvelope,
} from '@puntovivo/server/audit-anchor';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
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
import { assertSafeStorageUsable, openString, type SafeStorageLike } from './db-key-store.ts';

export const AUDIT_ANCHOR_STATE_FILE = '.audit-anchor-state.enc';
const ROOT_VERSION = 1 as const;

// The server reads and writes anchors inside synchronous SQLite transactions,
// which async safeStorage cannot serve, so the state is sealed in-process with
// a key derived from the keychain-sealed anchor secret.
const STATE_FORMAT = Buffer.from('PVA1', 'latin1');
const STATE_KEY_INFO = 'puntovivo:audit-anchor-state:v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function deriveStateKey(anchorSecret: string): Buffer {
  const secret = Buffer.from(anchorSecret, 'hex');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), STATE_KEY_INFO, 32));
}

function isStateFormat(sealed: Buffer): boolean {
  return sealed.subarray(0, STATE_FORMAT.length).equals(STATE_FORMAT);
}

function sealState(key: Buffer, plain: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(STATE_FORMAT);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([STATE_FORMAT, nonce, cipher.getAuthTag(), ciphertext]);
}

function openState(key: Buffer, sealed: Buffer): string {
  if (!isStateFormat(sealed) || sealed.length < STATE_FORMAT.length + NONCE_BYTES + TAG_BYTES) {
    throw new Error('unrecognised audit anchor state format');
  }
  const nonceEnd = STATE_FORMAT.length + NONCE_BYTES;
  const tagEnd = nonceEnd + TAG_BYTES;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    sealed.subarray(STATE_FORMAT.length, nonceEnd)
  );
  decipher.setAAD(STATE_FORMAT);
  decipher.setAuthTag(sealed.subarray(nonceEnd, tagEnd));
  return Buffer.concat([decipher.update(sealed.subarray(tagEnd)), decipher.final()]).toString(
    'utf8'
  );
}

export function getAuditAnchorStatePath(dataDir: string): string {
  return join(dataDir, AUDIT_ANCHOR_STATE_FILE);
}

interface AuditAnchorRootEnvelope {
  version: typeof ROOT_VERSION;
  tenants: Record<string, AuditAnchorStoredTenantEnvelope>;
}

export interface DesktopAuditAnchorStore extends AuditAnchorStore {
  replaceAll(points: ReadonlyArray<{ tenantId: string } & AuditAnchorPoint>): void;
}

function emptyEnvelope(): AuditAnchorRootEnvelope {
  return {
    version: ROOT_VERSION,
    tenants: Object.create(null) as Record<string, AuditAnchorStoredTenantEnvelope>,
  };
}

function parseRoot(parsed: unknown): AuditAnchorRootEnvelope {
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
  const tenants = Object.create(null) as Record<string, AuditAnchorStoredTenantEnvelope>;
  for (const [tenantId, envelope] of Object.entries(
    (parsed as { tenants: Record<string, AuditAnchorStoredTenantEnvelope> }).tenants
  )) {
    tenants[tenantId] = envelope;
  }
  return { version: ROOT_VERSION, tenants };
}

/**
 * `anchorSecret` is the keychain-sealed audit anchor secret. Earlier builds
 * sealed the state file with safeStorage itself; such a file is converted here
 * once, after which those builds cannot read it.
 */
export async function createSafeStorageAuditAnchorStore(options: {
  dataDir: string;
  safeStorage: SafeStorageLike;
  anchorSecret: string;
  platform?: NodeJS.Platform;
}): Promise<DesktopAuditAnchorStore> {
  const { dataDir, safeStorage, anchorSecret, platform = process.platform } = options;
  await assertSafeStorageUsable(safeStorage, platform);
  const statePath = getAuditAnchorStatePath(dataDir);
  const stateKey = deriveStateKey(anchorSecret);
  let conversionError: unknown = null;

  function readRoot(): AuditAnchorRootEnvelope {
    if (!existsSync(statePath)) return emptyEnvelope();
    const sealed = readFileSync(statePath);
    if (conversionError !== null && !isStateFormat(sealed)) {
      throw new Error('AUDIT_ANCHOR_STATE_DECRYPT_FAILED', { cause: conversionError });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(openState(stateKey, sealed));
    } catch (error) {
      throw new Error('AUDIT_ANCHOR_STATE_DECRYPT_FAILED', { cause: error });
    }
    return parseRoot(parsed);
  }

  function writeRoot(root: AuditAnchorRootEnvelope): void {
    mkdirSync(dirname(statePath), { recursive: true });
    const tmpPath = `${statePath}.tmp`;
    try {
      unlinkSync(tmpPath);
    } catch {
      // absent
    }
    const sealed = sealState(stateKey, JSON.stringify(root));
    writeFileSync(tmpPath, sealed, { flag: 'wx', mode: 0o600 });
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // Windows ACLs plus DPAPI own access control.
    }
    // Windows backs fsync with FlushFileBuffers, which needs a writable handle;
    // a read-only descriptor fails there with EPERM although POSIX accepts it.
    const file = openSync(tmpPath, 'r+');
    try {
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    try {
      renameSync(tmpPath, statePath);
      conversionError = null;
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

  if (existsSync(statePath)) {
    const existing = readFileSync(statePath);
    if (!isStateFormat(existing)) {
      // On failure the file stays as it was and every read fails closed.
      try {
        writeRoot(parseRoot(JSON.parse(await openString(safeStorage, existing))));
      } catch (error) {
        conversionError = error;
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
          version: AUDIT_ANCHOR_ENVELOPE_VERSION,
          confirmed: { counter: point.counter, headHash: point.headHash },
          pending: [],
        };
      }
      writeRoot(root);
    },
  };
}
