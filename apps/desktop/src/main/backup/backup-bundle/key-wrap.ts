/**
 * Optional passphrase key-wrap for backup bundles.
 *
 * Cross-device restore requires the SOURCE install's 64-hex SQLCipher
 * key — safe, but operationally hostile (the operator must reveal,
 * copy, and transport a raw key). A passphrase-protected bundle
 * instead carries `key-wrap.json`: the install key wrapped with
 * AES-256-GCM under a key derived from an operator-chosen passphrase
 * via scrypt (node:crypto, no new dependency; N=2^15 r=8 p=1 —
 * OWASP-adequate for an offline-attack surface of one file).
 *
 * The DB stays encrypted with the ORIGINAL install key — the wrap
 * only replaces "transport the hex" with "remember the phrase". A
 * bundle without the entry behaves exactly as before. The wrap is
 * only as strong as the passphrase; the UI enforces a minimum length
 * and the docs say to prefer a generated phrase.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

export interface BackupKeyWrap {
  v: 1;
  kdf: 'scrypt';
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  wrapped: string;
}

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
/** UI-enforced too, but the boundary revalidates. */
export const MIN_BACKUP_PASSPHRASE_LENGTH = 10;

interface KdfWaiter {
  signal: AbortSignal | undefined;
  grant: () => void;
  reject: (error: Error) => void;
  onAbort: (() => void) | undefined;
}

let kdfActive = false;
const kdfWaiters: KdfWaiter[] = [];

function backupKdfAbortError(): Error {
  const error = new Error('BACKUP_KDF_ABORTED');
  error.name = 'AbortError';
  return error;
}

function throwIfKdfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw backupKdfAbortError();
}

function removeAbortListener(waiter: KdfWaiter): void {
  if (waiter.signal && waiter.onAbort) {
    waiter.signal.removeEventListener('abort', waiter.onAbort);
  }
}

function grantNextKdfWaiter(): void {
  kdfActive = false;
  while (kdfWaiters.length > 0) {
    const waiter = kdfWaiters.shift()!;
    removeAbortListener(waiter);
    if (waiter.signal?.aborted) {
      waiter.reject(backupKdfAbortError());
      continue;
    }
    kdfActive = true;
    waiter.grant();
    return;
  }
}

function acquireKdfSlot(signal: AbortSignal | undefined): Promise<() => void> {
  throwIfKdfAborted(signal);
  return new Promise<() => void>((resolve, reject) => {
    let released = false;
    const grant = () => {
      resolve(() => {
        if (released) return;
        released = true;
        grantNextKdfWaiter();
      });
    };

    if (!kdfActive) {
      kdfActive = true;
      grant();
      return;
    }

    const waiter: KdfWaiter = {
      signal,
      grant,
      reject,
      onAbort: undefined,
    };
    if (signal) {
      waiter.onAbort = () => {
        const index = kdfWaiters.indexOf(waiter);
        if (index >= 0) kdfWaiters.splice(index, 1);
        removeAbortListener(waiter);
        reject(backupKdfAbortError());
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    }
    kdfWaiters.push(waiter);
    if (signal?.aborted) waiter.onAbort?.();
  });
}

function runScrypt(
  passphrase: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Preserve the v1 byte contract exactly: NFKC input, 16-byte salt,
    // 32-byte output, and the original N/r/p/maxmem profile. Only the
    // execution model changes from main-thread blocking to libuv async work.
    scrypt(
      passphrase.normalize('NFKC'),
      salt,
      32,
      { N: n, r, p, maxmem: 128 * n * r * 2 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

function waitForKdfOrAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfKdfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(backupKdfAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

async function deriveWrapKey(
  passphrase: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  signal: AbortSignal | undefined
): Promise<Buffer> {
  const release = await acquireKdfSlot(signal);
  try {
    throwIfKdfAborted(signal);
  } catch (error) {
    release();
    throw error;
  }

  const job = runScrypt(passphrase, salt, n, r, p);
  // Cancellation returns promptly to the caller, but the native scrypt job
  // keeps its slot until its callback settles. Otherwise a cancellation storm
  // could defeat the one-job memory bound while abandoned libuv work remains.
  void job.then(derivedKey => {
    // An aborted caller never receives this buffer, so it cannot run the
    // wrap/unwrap finally block that normally wipes it.
    if (signal?.aborted) derivedKey.fill(0);
    release();
  }, release);
  return waitForKdfOrAbort(job, signal);
}

function decodeCanonicalBase64(value: unknown, byteLength: number): Buffer | null {
  if (typeof value !== 'string') return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === byteLength && decoded.toString('base64') === value ? decoded : null;
}

export async function wrapBackupKey(
  encryptionKeyHex: string,
  passphrase: string,
  options: { signal?: AbortSignal | undefined } = {}
): Promise<BackupKeyWrap> {
  if (passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    throw new Error('BACKUP_PASSPHRASE_TOO_SHORT');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrapKey = await deriveWrapKey(
    passphrase,
    salt,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    options.signal
  );
  try {
    const cipher = createCipheriv('aes-256-gcm', wrapKey, iv);
    const wrapped = Buffer.concat([cipher.update(encryptionKeyHex, 'utf8'), cipher.final()]);
    return {
      v: 1,
      kdf: 'scrypt',
      n: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      wrapped: wrapped.toString('base64'),
    };
  } finally {
    wrapKey.fill(0);
  }
}

/**
 * Unwrap the install key with the operator's passphrase. Returns the
 * 64-hex key, or null when the passphrase is wrong (GCM tag failure)
 * or the wrap blob is malformed — the caller shows a retryable
 * wrong-passphrase error either way, never a crash.
 */
export async function unwrapBackupKey(
  wrap: BackupKeyWrap,
  passphrase: string,
  options: { signal?: AbortSignal | undefined } = {}
): Promise<string | null> {
  let wrapKey: Buffer | undefined;
  try {
    if (wrap.v !== 1 || wrap.kdf !== 'scrypt') return null;
    // v1 has ONE cost profile. Accepting a broad upper range still
    // lets an attacker make the synchronous main-process KDF consume
    // hundreds of MB before authentication. A future profile needs a
    // new wrap version and an explicit migration contract.
    if (wrap.n !== SCRYPT_N || wrap.r !== SCRYPT_R || wrap.p !== SCRYPT_P) return null;
    const salt = decodeCanonicalBase64(wrap.salt, 16);
    const iv = decodeCanonicalBase64(wrap.iv, 12);
    const tag = decodeCanonicalBase64(wrap.tag, 16);
    // The wrapped value is the 64-byte ASCII SQLCipher hex key. Pinning
    // its encrypted length rejects malformed blobs before paying scrypt.
    const wrapped = decodeCanonicalBase64(wrap.wrapped, 64);
    if (!salt || !iv || !tag || !wrapped) return null;
    wrapKey = await deriveWrapKey(passphrase, salt, wrap.n, wrap.r, wrap.p, options.signal);
    const decipher = createDecipheriv('aes-256-gcm', wrapKey, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(wrapped), decipher.final()]).toString('utf8');
    if (!/^[0-9a-f]{64}$/i.test(plain)) return null;
    return plain;
  } catch {
    if (options.signal?.aborted) throw backupKdfAbortError();
    return null;
  } finally {
    wrapKey?.fill(0);
  }
}

/** Constant-time hex comparison helper shared by restore paths. */
export function hexKeysEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
