/**
 * ENG-052 — Device id resolution for the renderer.
 *
 * The Command Envelope (ADR-0002) requires every critical mutation
 * to ship `x-device-id`. The id comes from `auth.registerDevice`
 * called once after login; the renderer persists it locally and
 * reuses it across sessions.
 *
 * Storage strategy:
 *
 * - **Electron**: prefer `window.electron.device.getId()` so the id
 *   lives in the user's userData folder (survives browser cache
 *   wipes). The Electron preload populates this in a follow-up
 *   ticket (ENG-052b); for now we fall back to localStorage.
 * - **Web (browser)**: localStorage under the key
 *   `puntovivo:deviceId`.
 *
 * The id is **server-issued** by `auth.registerDevice`; the
 * renderer never generates one client-side. The server controls the
 * uniqueness and the audit lineage.
 *
 * @module lib/deviceId
 */

const STORAGE_KEY = 'puntovivo:deviceId';

interface ElectronDeviceBridge {
  getId(): Promise<string | null>;
  setId(id: string): Promise<void>;
}

/**
 * Read the `device` namespace from the Electron preload bridge
 * without redeclaring `window.electron` globally (other helpers
 * like the receipt printer and i18n already extend the same
 * surface). Returns `undefined` when not running under Electron.
 */
function getElectronDeviceBridge(): ElectronDeviceBridge | undefined {
  const electron = (window as unknown as { electron?: { device?: ElectronDeviceBridge } })
    .electron;
  return electron?.device;
}

/**
 * Single warning channel for non-fatal device-id storage failures so
 * the operator can correlate them across boot, login, and logout
 * paths. The id resolution falls back gracefully (Electron bridge →
 * localStorage → null), so a single failure does not block the user;
 * the warning makes the failure observable in the browser console.
 */
function warnDeviceIdFailure(reason: string, error: unknown): void {
  console.warn(`puntovivo:deviceId: ${reason}`, error);
}

/**
 * Read the persisted device id, preferring Electron's userData
 * folder when running in the desktop runtime. Returns `null` when
 * no id has been registered yet — the caller must trigger
 * `auth.registerDevice` and persist the result via `storeDeviceId`.
 */
export async function readDeviceId(): Promise<string | null> {
  const electronBridge = getElectronDeviceBridge();
  if (electronBridge && typeof electronBridge.getId === 'function') {
    try {
      const fromElectron = await electronBridge.getId();
      if (fromElectron) return fromElectron;
    } catch (error) {
      // Electron bridge failure → fall through to localStorage.
      warnDeviceIdFailure(
        'Electron bridge getId() failed; falling back to localStorage',
        error
      );
    }
  }
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch (error) {
    warnDeviceIdFailure(
      'localStorage read failed (likely Safari private mode or quota); device id treated as missing',
      error
    );
    return null;
  }
}

/**
 * Persist the server-issued device id. When running in Electron,
 * also writes to the userData folder so a localStorage clear does
 * not lose the registration.
 */
export async function storeDeviceId(deviceId: string): Promise<void> {
  try {
    window.localStorage.setItem(STORAGE_KEY, deviceId);
  } catch (error) {
    // localStorage write failure is non-fatal — the in-memory cache
    // below will still serve subsequent requests in the same tab,
    // but the operator should know the id will not survive a reload.
    warnDeviceIdFailure(
      'localStorage write failed; device id will not survive page reload',
      error
    );
  }

  const electronBridge = getElectronDeviceBridge();
  if (electronBridge && typeof electronBridge.setId === 'function') {
    try {
      await electronBridge.setId(deviceId);
    } catch (error) {
      // Electron persistence failure: localStorage still has the id,
      // but the userData copy is missing — the desktop binary will
      // re-read from localStorage on next launch (acceptable).
      warnDeviceIdFailure(
        'Electron bridge setId() failed; userData copy is missing but localStorage remains authoritative',
        error
      );
    }
  }

  cachedDeviceId = deviceId;
}

// Synchronous in-memory cache so the tRPC headers function (which
// must be sync) can read the id without an await. Populated by
// `primeDeviceIdCache()` (called once at app boot) and updated by
// `storeDeviceId`.
let cachedDeviceId: string | null = null;

export async function primeDeviceIdCache(): Promise<string | null> {
  cachedDeviceId = await readDeviceId();
  return cachedDeviceId;
}

/**
 * Sync read of the cached device id. Call `primeDeviceIdCache()`
 * during AuthProvider boot to populate the cache. The tRPC headers
 * helper relies on this for per-request lookup without async.
 */
export function getCachedDeviceIdSync(): string | null {
  return cachedDeviceId;
}
