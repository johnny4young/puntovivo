export type AutoUpdateState =
  'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';

/**
 * How an available update is delivered to the user:
 *   - `auto`: Squirrel downloads + installs in the background (public repo).
 *   - `manual`: the updater only detects + notifies; the user downloads the
 *     release themselves (private repo, notify-only mode).
 */
export type AutoUpdateInstallMode = 'auto' | 'manual';

export interface AutoUpdateStatus {
  isAvailable: boolean;
  state: AutoUpdateState;
  /** Whether updates install automatically (`auto`) or are user-driven (`manual`). */
  installMode: AutoUpdateInstallMode;
  currentVersion: string;
  lastCheckedAt: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  /** In `manual` mode this is the release PAGE the user opens to download. */
  updateUrl: string | null;
  error: string | null;
  reason: string | null;
}

export interface AutoUpdateActionResult {
  success: boolean;
  error?: string;
}
