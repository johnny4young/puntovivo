/**
 * allowlist-only support snapshot projection.
 *
 * This helper intentionally accepts richer device records structurally but
 * projects only health counts and app versions. Never spread source records
 * into the output: authority data also carries device, site, and tenant-adjacent
 * identifiers that do not belong in a portable first-line support artifact.
 */

export type SupportAutoUpdateState =
  'unavailable' | 'idle' | 'checking' | 'available' | 'downloaded' | 'error';

export interface SupportSnapshotDeviceSource {
  healthStatus: 'online' | 'stale' | 'revoked';
  appVersion?: string | null | undefined;
}

export interface SupportSnapshotSource {
  runtime: {
    kind: 'web' | 'desktop';
    currentVersion: string | null;
    updateState: SupportAutoUpdateState;
  };
  modules: Readonly<Record<string, boolean>>;
  devices: readonly SupportSnapshotDeviceSource[];
  telemetryEnabled: boolean;
}

export type SupportSnapshotData = readonly [
  runtimeKind: SupportSnapshotSource['runtime']['kind'],
  currentVersion: string | null,
  updateState: SupportAutoUpdateState,
  modules: SupportSnapshotSource['modules'],
  devices: SupportSnapshotSource['devices'],
  telemetryEnabled: boolean,
  disabled: boolean,
];

export interface SupportSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  runtime: SupportSnapshotSource['runtime'];
  modules: {
    active: number;
    total: number;
  };
  devices: {
    active: number;
    online: number;
    stale: number;
    revoked: number;
    appVersions: string[];
  };
  telemetry: {
    enabled: boolean;
  };
}

export function createSupportSnapshot(
  source: SupportSnapshotSource,
  now: Date = new Date()
): SupportSnapshot {
  const moduleStates = Object.values(source.modules);
  const online = source.devices.filter(device => device.healthStatus === 'online').length;
  const stale = source.devices.filter(device => device.healthStatus === 'stale').length;
  const revoked = source.devices.filter(device => device.healthStatus === 'revoked').length;
  const appVersions = [
    ...new Set(
      source.devices
        .map(device => device.appVersion?.trim())
        .filter((version): version is string => Boolean(version))
    ),
  ].sort((left, right) => left.localeCompare(right));

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    runtime: {
      kind: source.runtime.kind,
      currentVersion: source.runtime.currentVersion,
      updateState: source.runtime.updateState,
    },
    modules: {
      active: moduleStates.filter(Boolean).length,
      total: moduleStates.length,
    },
    devices: {
      active: online + stale,
      online,
      stale,
      revoked,
      appVersions,
    },
    telemetry: {
      enabled: source.telemetryEnabled,
    },
  };
}

export function serializeSupportSnapshot(snapshot: SupportSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function supportSnapshotFilename(generatedAt: string): string {
  const timestamp = generatedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `puntovivo-support-snapshot-${timestamp}.json`;
}
