import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import type { BackupRestoreDrillReport, ElectronAPI } from '@/types/electron';
import { BackupRestoreDrillPanel } from '../BackupRestoreDrillPanel';

const REPORT: BackupRestoreDrillReport = {
  outcome: 'passed',
  checkedAt: '2026-07-14T12:05:00.000Z',
  snapshotGeneratedAt: '2026-07-14T12:00:00.000Z',
  snapshotSchemaVersion: 1,
  snapshotSizeBytes: 2_048,
  currentTotal: 12,
  snapshotTotal: 9,
  tables: [
    { table: 'products', currentCount: 3, snapshotCount: 2, delta: 1 },
    { table: 'customers', currentCount: 2, snapshotCount: 1, delta: 1 },
    { table: 'sales', currentCount: 2, snapshotCount: 2, delta: 0 },
    { table: 'inventory_movements', currentCount: 4, snapshotCount: 3, delta: 1 },
    { table: 'audit_logs', currentCount: 1, snapshotCount: 1, delta: 0 },
  ],
};

function installElectron(overrides: Partial<ElectronAPI> = {}) {
  window.electron = {
    getAppVersion: vi.fn(),
    getAppPath: vi.fn(),
    getServerUrl: vi.fn(),
    getAutoUpdateStatus: vi.fn(),
    checkForAppUpdates: vi.fn(),
    restartToApplyAppUpdate: vi.fn(),
    getTraySettings: vi.fn(),
    updateTraySettings: vi.fn(),
    getThemePreference: vi.fn(),
    updateThemePreference: vi.fn(),
    getReceiptPrintSettings: vi.fn(),
    updateReceiptPrintSettings: vi.fn(),
    createDatabaseBackup: vi.fn(),
    restoreDatabaseBackup: vi.fn(),
    printReceipt: vi.fn(),
    runBackupRestoreDrill: vi.fn().mockResolvedValue({ success: true, report: REPORT }),
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <ToastProvider>
      <BackupRestoreDrillPanel />
    </ToastProvider>
  );
}

describe('BackupRestoreDrillPanel', () => {
  beforeEach(() => {
    delete window.electron;
  });

  afterEach(() => {
    delete window.electron;
  });

  it('shows an explicit upgrade state outside the supported desktop bridge', () => {
    renderPanel();

    expect(
      screen.getByText(/update the desktop app to run restore readiness drills/i)
    ).toBeInTheDocument();
  });

  it('runs the drill and renders the current-versus-snapshot comparison', async () => {
    const user = userEvent.setup();
    const runBackupRestoreDrill = vi.fn().mockResolvedValue({ success: true, report: REPORT });
    installElectron({ runBackupRestoreDrill });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /run restore drill/i }));

    expect(runBackupRestoreDrill).toHaveBeenCalledTimes(1);
    const report = await screen.findByTestId('backup-restore-drill-report');
    expect(within(report).getByText(/ready to restore/i)).toBeInTheDocument();
    expect(within(report).getByText(/live database was not changed/i)).toBeInTheDocument();
    const products = within(report).getByRole('row', { name: /products 3 2 \+1/i });
    expect(products).toBeInTheDocument();
    expect(within(report).getByRole('row', { name: /sales 2 2 0/i })).toBeInTheDocument();
  });

  it('explains that a snapshot must exist before the drill can run', async () => {
    const user = userEvent.setup();
    installElectron({
      runBackupRestoreDrill: vi
        .fn()
        .mockResolvedValue({ success: false, error: 'snapshot_unavailable' }),
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /run restore drill/i }));

    expect(
      await screen.findByText(/create at least one encrypted snapshot before/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId('backup-restore-drill-report')).not.toBeInTheDocument();
  });
});
