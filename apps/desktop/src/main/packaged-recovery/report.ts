import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PackagedRecoveryDatasetCounts } from './profile.ts';

export type PackagedRecoveryOutcome = 'passed' | 'failed';

export interface PackagedRecoveryCheck {
  id: string;
  outcome: PackagedRecoveryOutcome;
  detail: string;
}

export interface PackagedRecoveryReport {
  schemaVersion: 1;
  outcome: PackagedRecoveryOutcome;
  candidateSha: string;
  startedAt: string;
  completedAt: string;
  environment: {
    packaged: true;
    platform: NodeJS.Platform;
    architecture: string;
    nodeVersion: string;
    electronVersion: string;
    appVersion: string;
    databaseSchemaVersion: number;
  };
  dataset: {
    profile: string;
    counts: PackagedRecoveryDatasetCounts;
    totalBusinessRows: number;
    logicalSha256: string | null;
    databaseBytes: number;
  };
  recovery: {
    bundleSha256: string | null;
    bundleBytes: number;
    manifestSchemaVersion: number | null;
    sourceDatabaseSha256: string | null;
    restoredDatabaseSha256: string | null;
    restoredLogicalSha256: string | null;
    recoveryPointAgeMs: number | null;
    recoveryTimeMs: number | null;
    wrongKeyRejected: boolean;
    corruptBundleRejected: boolean;
    sourceDatabaseUnchanged: boolean;
    restoredCopyBooted: boolean;
  };
  timings: {
    datasetSeedMs: number;
    backupMs: number;
    wrongKeyRejectionMs: number;
    corruptBundleRejectionMs: number;
    restoreMs: number;
    restoredBootMs: number;
    totalMs: number;
  };
  checks: PackagedRecoveryCheck[];
  failureCode: string | null;
}

export function roundMilliseconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function writePackagedRecoveryReport(
  outputDirectory: string,
  report: PackagedRecoveryReport
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
