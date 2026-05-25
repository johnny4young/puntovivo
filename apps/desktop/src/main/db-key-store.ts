/**
 * ENG-167 — SQLCipher key bootstrap.
 *
 * The embedded SQLite database is encrypted with a per-install
 * 32-byte key that lives only on disk inside an OS-keychain-sealed
 * envelope. The mechanics:
 *
 *   1. `getOrCreateDbKey(dataDir)` is called once at Electron main
 *      startup, BEFORE `createServer()`. The function looks for
 *      `<dataDir>/.dbkey.enc`.
 *   2. If the file is missing (fresh install, post-wipe), the module
 *      generates a fresh 32-byte secret via `crypto.randomBytes`, asks
 *      Electron's `safeStorage` to encrypt it with the platform
 *      keychain (macOS Keychain, Windows DPAPI, Linux libsecret), and
 *      persists the ciphertext at the canonical path with `0600`
 *      permissions.
 *   3. If the file exists, it is decrypted via `safeStorage.decryptString`
 *      and the recovered hex is returned.
 *   4. The hex is forwarded to `createServer({ encryptionKey })` and
 *      from there into `initDatabase`, which selects SQLCipher v4 and
 *      issues `PRAGMA key` before any other file-touching PRAGMA so the
 *      on-disk `local.db` is unreadable without it.
 *
 * Threat model defended:
 *   - Device theft / stolen laptop → attacker has the encrypted DB
 *     but not the OS user's keychain unlock.
 *   - Disk side-channel / forensic image → same: keychain-sealed
 *     envelope is unreadable without the live OS user session.
 *
 * Threat model NOT defended:
 *   - A running process with the unlocked key. Once Electron is
 *     running and safeStorage has handed the key over, the key sits
 *     in process memory; a malicious agent inside the same process
 *     can read it. ENG-167 deliberately scopes to disk-at-rest.
 *
 * Step-1 (this module) covers fresh installs and idempotent re-boots
 * on the same device. The follow-up ENG-167b will land:
 *   - One-shot migration of pre-encryption cleartext DBs.
 *   - Restore-from-different-device UX (prompt for the source key).
 *   - Cross-OS matrix validation through `.github/workflows/build-desktop.yml`.
 */
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Narrow contract for the subset of Electron's `safeStorage` we
 * depend on. The Electron-specific import lives in `main/index.ts`
 * (the only file in the workspace that may pull from `electron`
 * outside of `import type`); this module accepts it as an argument
 * so the unit tests under `__tests__/db-key-store.test.ts` can pass
 * a deterministic stub without booting the Electron runtime — Node's
 * built-in test runner has no native module-mocking facility, and a
 * top-level `import { safeStorage } from 'electron'` crashes outside
 * of an actual Electron context.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(sealed: Buffer): string;
}

/**
 * File name inside the DB directory that holds the safeStorage-sealed
 * key envelope. Hidden + extension makes the role obvious to anyone
 * inspecting the data folder.
 */
export const DB_KEY_FILE = '.dbkey.enc';

/**
 * 64 hex characters → 32 raw bytes → 256-bit cipher key. Matches the
 * SQLCipher v4 default page key size. Server-side validation in
 * `packages/server/src/db/index.ts` rejects anything else, so changing
 * this constant requires bumping the assertion there too.
 */
const KEY_HEX_LENGTH = 64;

/**
 * Resolve (or initialise) the SQLCipher key for the current install.
 *
 * @param dataDir Absolute path to the directory that holds the SQLite
 *   DB file. The key envelope lives next to the DB so local diagnostics
 *   can find both pieces, but app-level backup ZIPs intentionally keep
 *   shipping only the encrypted DB plus device identity; restore from a
 *   different device fails until ENG-167b ships the key-prompt UX.
 *
 * @throws when Electron's `safeStorage` reports the platform keychain
 *   is unavailable. We refuse to persist a key in cleartext as a
 *   silent fallback — an unreachable keychain on Linux (no
 *   libsecret / gnome-keyring / KWallet) is an operator-visible
 *   error, not a confidentiality downgrade.
 *
 * @throws when the envelope file exists but `safeStorage.decryptString`
 *   rejects it (corrupt, truncated, or sealed by a different OS user).
 *   The message points at the canonical recovery path: wipe the data
 *   directory and let the next boot regenerate, OR restore from a
 *   matching backup. Surfacing the error is preferable to a silent
 *   key regeneration that would orphan the existing encrypted DB.
 */
export async function getOrCreateDbKey(
  dataDir: string,
  safeStorage: SafeStorageLike
): Promise<string> {
  // safeStorage requires `app.ready`. Callers must await `app.whenReady()`
  // before invoking this function; we do not silently swallow the
  // race because a too-early call returns `false` from
  // `isEncryptionAvailable()` and would mis-trip the operator error.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain is unavailable; refusing to persist the SQLCipher key in cleartext. ' +
        'On Linux, install libsecret/gnome-keyring or KWallet; on macOS verify Keychain Access; ' +
        'on Windows verify DPAPI (current user profile).'
    );
  }

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const envelopePath = join(dataDir, DB_KEY_FILE);

  if (existsSync(envelopePath)) {
    const sealed = readFileSync(envelopePath);
    let recovered: string;
    try {
      recovered = safeStorage.decryptString(sealed);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `failed to decrypt the SQLCipher key envelope at ${envelopePath} (${reason}). ` +
          'This means the OS keychain rejected the sealed blob — typically because the ' +
          'envelope was sealed by a different OS user, the keychain entry was revoked, or ' +
          'the file is corrupt. Restore from a matching backup or wipe the data directory ' +
          'to regenerate (cleartext DBs from before ENG-167 must be migrated separately ' +
          'in ENG-167b).',
        { cause: err }
      );
    }
    if (recovered.length !== KEY_HEX_LENGTH || !/^[0-9a-f]+$/i.test(recovered)) {
      throw new Error(
        `SQLCipher key envelope at ${envelopePath} decrypted to an invalid shape; expected ${KEY_HEX_LENGTH} hex characters`
      );
    }
    return recovered;
  }

  // First boot on this install: mint a fresh 256-bit key, seal it,
  // and persist with `0600` so other OS users on the same machine
  // cannot copy the envelope file (defence-in-depth on top of the
  // keychain seal — the keychain already binds the unlock to the
  // active OS user session).
  //
  // Atomic write-then-rename: a SIGKILL between `writeFileSync` and
  // the next boot would otherwise leave a truncated envelope at the
  // canonical path. The next boot would see `existsSync === true`,
  // load the partial bytes, fail to decrypt, and steer the operator
  // into the "wipe the data directory" branch — even though the
  // underlying encrypted DB is still intact. Writing to `.tmp` first
  // and `renameSync` over the final path leaves the canonical name
  // pointing at either the previous envelope (which does not exist
  // here because this is the first-boot branch) or the fully-written
  // new one — never an intermediate state. `rename` is atomic on
  // POSIX and on Windows NTFS for same-filesystem moves. The
  // `chmod 0600` runs on the temp file BEFORE the rename so the
  // final inode never has weaker permissions even momentarily.
  const freshKey = randomBytes(32).toString('hex');
  const sealed = safeStorage.encryptString(freshKey);
  const tmpPath = `${envelopePath}.tmp`;
  // `wx` flag — exclusive create. Refuses to overwrite a stale `.tmp`
  // from a previous crash so we never silently merge state.
  writeFileSync(tmpPath, sealed, { flag: 'wx' });
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // POSIX-only; Windows applies ACL semantics via DPAPI binding +
    // the userData folder ACL. We tolerate `chmod` failures rather
    // than abort the boot because the keychain seal remains effective.
  }
  try {
    renameSync(tmpPath, envelopePath);
  } catch (err) {
    // Best-effort cleanup of the temp file so the next boot does not
    // hit the `wx` exclusive-create guard above.
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore — surfacing the rename error is more useful than this.
    }
    throw err;
  }
  return freshKey;
}

/**
 * Helper for tests / diagnostics: returns the canonical envelope path
 * without touching disk. Kept exported so the integration test can
 * write its own fixture envelope before invoking `getOrCreateDbKey`.
 */
export function getDbKeyEnvelopePath(dataDir: string): string {
  return join(dataDir, DB_KEY_FILE);
}

/**
 * Convenience for the Electron main caller: from a full DB path (e.g.
 * `<userData>/data/local.db`), derive the directory the envelope
 * should live in (`<userData>/data/`). Centralising this avoids a
 * subtle bug where main/index.ts and the key store disagree on which
 * folder gets the envelope.
 */
export function getDbKeyDir(dbPath: string): string {
  return dirname(dbPath);
}
