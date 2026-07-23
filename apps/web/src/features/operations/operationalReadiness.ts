import type { OperationalServiceId } from '@puntovivo/shared/operational-readiness';
import type { BackupScheduleStatus, ElectronAPI } from '@/types/electron';

export type OperationalSignalStatus = 'healthy' | 'watch' | 'action_required' | 'unavailable';

export interface OperationalSignal {
  status: OperationalSignalStatus;
  observation: string;
  count?: number;
}

export interface AttentionAreaSignal {
  area: 'sync' | 'fiscal' | 'device' | 'payments';
  severity: 'danger' | 'warning';
  count: number;
}

type AutoUpdateStatus = Awaited<ReturnType<ElectronAPI['getAutoUpdateStatus']>>;

export function evaluateServerSignal(
  serviceId: Extract<OperationalServiceId, 'sync' | 'fiscal' | 'device' | 'payments'>,
  areas: readonly AttentionAreaSignal[] | undefined,
  queryState: 'loading' | 'error' | 'ready'
): OperationalSignal {
  if (queryState === 'loading') return { status: 'watch', observation: 'checking' };
  if (queryState === 'error') return { status: 'unavailable', observation: 'signalUnavailable' };

  const area = areas?.find(entry => entry.area === serviceId);
  if (!area) return { status: 'healthy', observation: 'clear' };
  return {
    status: area.severity === 'danger' ? 'action_required' : 'watch',
    observation: area.severity === 'danger' ? 'failedItems' : 'queuedItems',
    count: area.count,
  };
}

export function evaluateBackupSignal(
  status: BackupScheduleStatus | undefined,
  options: {
    supported: boolean;
    isAdmin: boolean;
    failed: boolean;
    loading: boolean;
    maximumAgeHours: number;
    nowMs?: number;
  }
): OperationalSignal {
  if (!options.supported) return { status: 'unavailable', observation: 'desktopRequired' };
  if (!options.isAdmin) return { status: 'unavailable', observation: 'adminOwned' };
  if (options.loading) return { status: 'watch', observation: 'checking' };
  if (options.failed || !status) {
    return { status: 'action_required', observation: 'signalUnavailable' };
  }
  if (status.lastError) return { status: 'action_required', observation: 'backupFailed' };
  if (status.frequency === 'off') return { status: 'action_required', observation: 'backupOff' };
  if (status.inProgress) return { status: 'watch', observation: 'backupRunning' };
  if (!status.lastSuccessAt) return { status: 'action_required', observation: 'backupMissing' };

  const nowMs = options.nowMs ?? Date.now();
  const snapshotAgeMs = nowMs - Date.parse(status.lastSuccessAt);
  if (
    !Number.isFinite(snapshotAgeMs) ||
    snapshotAgeMs < 0 ||
    snapshotAgeMs > options.maximumAgeHours * 3_600_000
  ) {
    return { status: 'action_required', observation: 'backupStale' };
  }
  return { status: 'healthy', observation: 'backupFresh' };
}

export function evaluateUpdateSignal(
  status: AutoUpdateStatus | undefined,
  options: {
    supported: boolean;
    failed: boolean;
    loading: boolean;
    maximumAgeHours: number;
    nowMs?: number;
  }
): OperationalSignal {
  if (!options.supported) return { status: 'unavailable', observation: 'desktopRequired' };
  if (options.loading) return { status: 'watch', observation: 'checking' };
  if (options.failed || !status || status.state === 'error') {
    return { status: 'action_required', observation: 'updateFailed' };
  }
  if (status.state === 'available' || status.state === 'downloaded') {
    return { status: 'watch', observation: 'updateReady' };
  }
  if (status.state === 'checking') return { status: 'watch', observation: 'checking' };
  if (status.state === 'unavailable') {
    return { status: 'unavailable', observation: 'updateUnavailable' };
  }
  if (!status.lastCheckedAt) return { status: 'watch', observation: 'updateUnchecked' };

  const nowMs = options.nowMs ?? Date.now();
  const checkAgeMs = nowMs - Date.parse(status.lastCheckedAt);
  if (
    !Number.isFinite(checkAgeMs) ||
    checkAgeMs < 0 ||
    checkAgeMs > options.maximumAgeHours * 3_600_000
  ) {
    return { status: 'watch', observation: 'updateStale' };
  }
  return { status: 'healthy', observation: 'updateCurrent' };
}
