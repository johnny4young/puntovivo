export type AutoUpdateState =
  'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';

/** Optional fields preserve compatibility with older desktop preload payloads. */
export type AutoUpdateInstallMode = 'auto' | 'manual';
export interface AutoUpdateStatus {
  isAvailable: boolean;
  state: AutoUpdateState;
  installMode?: AutoUpdateInstallMode;
  currentVersion: string;
  lastCheckedAt: string | null;
  lastUpdatedAt?: string | null;
  downloadedVersion?: string | null;
  downloadedAt?: string | null;
  installReady?: boolean;
  updateFloorVersion?: string | null;
  rolloutMode?: 'normal' | 'rollback' | null;
  rolloutPercentage?: 10 | 50 | 100 | null;
  rolloutTargetVersion?: string | null;
  rolloutPolicyCheckedAt?: string | null;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  updateUrl: string | null;
  error: string | null;
  reason: string | null;
}

export const autoUpdateStatusQueryKey = ['desktop', 'auto-update-status'] as const;
export const defaultAutoUpdateStatus: AutoUpdateStatus = {
  isAvailable: false,
  state: 'unavailable',
  installMode: 'auto',
  currentVersion: '',
  lastCheckedAt: null,
  lastUpdatedAt: null,
  downloadedVersion: null,
  downloadedAt: null,
  installReady: false,
  updateFloorVersion: null,
  rolloutMode: null,
  rolloutPercentage: null,
  rolloutTargetVersion: null,
  rolloutPolicyCheckedAt: null,
  releaseName: null,
  releaseNotes: null,
  releaseDate: null,
  updateUrl: null,
  error: null,
  reason: null,
};
