/** one lazy boundary for guided recovery and portable evidence. */

import { SupportRecoveryChecklist } from './SupportRecoveryChecklist';
import { SupportIncidentPlaybooks } from './SupportIncidentPlaybooks';
import { SupportSnapshotPanel } from './SupportSnapshotPanel';
import type { SupportSnapshotData } from './supportSnapshot';
import type { SupportUpdateRecoveryState } from './SupportRecoveryChecklist';

interface SupportReadinessPanelsProps {
  isAdmin: boolean;
  isDesktop: boolean;
  updateState: SupportUpdateRecoveryState;
  staleDeviceCount: number;
  telemetryEnabled: boolean;
  hasSignalError: boolean;
  onNavigate: (route: string) => void;
  snapshotData: SupportSnapshotData;
}

export function SupportReadinessPanels({
  isAdmin,
  isDesktop,
  updateState,
  staleDeviceCount,
  telemetryEnabled,
  hasSignalError,
  onNavigate,
  snapshotData,
}: SupportReadinessPanelsProps) {
  const [kind, currentVersion, snapshotUpdateState, modules, devices, snapshotTelemetry, disabled] =
    snapshotData;

  return (
    <>
      <SupportRecoveryChecklist
        isAdmin={isAdmin}
        updateState={updateState}
        staleDeviceCount={staleDeviceCount}
        telemetryEnabled={telemetryEnabled}
        hasSignalError={hasSignalError}
        onNavigate={onNavigate}
      />
      <SupportIncidentPlaybooks isAdmin={isAdmin} isDesktop={isDesktop} onNavigate={onNavigate} />
      <SupportSnapshotPanel
        source={{
          runtime: { kind, currentVersion, updateState: snapshotUpdateState },
          modules,
          devices,
          telemetryEnabled: snapshotTelemetry,
        }}
        disabled={disabled}
      />
    </>
  );
}
