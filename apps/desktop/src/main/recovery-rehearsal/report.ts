import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type RecoveryCheckOutcome = 'passed' | 'failed';

export interface RecoveryCheck {
  id: string;
  outcome: RecoveryCheckOutcome;
  detail: string;
}

export interface RecoveryTimingReport {
  fixtureBuildMs: number;
  upgradeMs: number;
  downgradeRefusalMs: number;
  idempotentBootMs: number;
  backupMs: number;
  restoreMs: number;
  totalMs: number;
}

export interface RecoveryEnvironmentReport {
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
}

export interface RecoveryBackupReport {
  bundleSha256: string | null;
  bundleBytes: number;
  manifestSchemaVersion: number | null;
  snapshotGeneratedAt: string | null;
  deviceIdentityIncluded: boolean;
}

export interface RecoveryRestoreReport {
  databaseSha256: string | null;
  migrationCount: number;
  historicalTableCount: number;
  currentTableCount: number;
  destinationKeyVerified: boolean;
  sourceKeyRejected: boolean;
  deviceIdentityPreserved: boolean;
  snapshotAgeAtRestoreMs: number | null;
}

export interface RecoveryRehearsalReport {
  reportVersion: 2;
  runId: string;
  outcome: RecoveryCheckOutcome;
  sourceVersion: string;
  targetVersion: string;
  startedAt: string;
  completedAt: string;
  sourceMigrationCount: number;
  targetMigrationCount: number;
  databaseSha256: string | null;
  encryptionEnabled: true;
  environment: RecoveryEnvironmentReport;
  timings: RecoveryTimingReport;
  backup: RecoveryBackupReport;
  restore: RecoveryRestoreReport;
  checks: RecoveryCheck[];
  failureCode: string | null;
}

export function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function writeRecoveryReport(
  outputDirectory: string,
  report: RecoveryRehearsalReport
): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const reportPath = join(outputDirectory, 'report.json');
  const temporaryPath = join(outputDirectory, '.report.json.tmp');
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, reportPath);
  return reportPath;
}
