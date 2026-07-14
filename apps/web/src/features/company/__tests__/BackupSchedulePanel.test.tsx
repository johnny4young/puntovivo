import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import type { BackupScheduleStatus, ElectronAPI } from '@/types/electron';
import { BackupSchedulePanel } from '../BackupSchedulePanel';

const baseStatus: BackupScheduleStatus = {
  tenantId: 'tenant-a',
  frequency: 'off',
  destinationMode: 'managed',
  destinationDirectory: '/tmp/puntovivo/backups/tenant-a',
  updatedAt: '2026-07-14T12:00:00.000Z',
  nextRunAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastPath: null,
  lastSizeBytes: null,
  lastError: null,
  inProgress: false,
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
    getBackupScheduleStatus: vi.fn().mockResolvedValue({ success: true, status: baseStatus }),
    updateBackupSchedule: vi.fn().mockResolvedValue({ success: true, status: baseStatus }),
    chooseBackupScheduleDestination: vi.fn().mockResolvedValue({ success: false, cancelled: true }),
    runBackupSnapshotNow: vi.fn().mockResolvedValue({ success: true, status: baseStatus }),
    ...overrides,
  };
}

function renderPanel(props: React.ComponentProps<typeof BackupSchedulePanel> = {}) {
  return render(
    <ToastProvider>
      <BackupSchedulePanel {...props} />
    </ToastProvider>
  );
}

describe('BackupSchedulePanel (ENG-136a)', () => {
  beforeEach(() => {
    delete window.electron;
  });

  afterEach(() => {
    delete window.electron;
  });

  it('shows an explicit upgrade state when the desktop bridge is unavailable', () => {
    renderPanel();

    expect(
      screen.getByText(/update the desktop app to configure scheduled snapshots/i)
    ).toBeInTheDocument();
  });

  it('loads status and persists a daily schedule', async () => {
    const user = userEvent.setup();
    const dailyStatus: BackupScheduleStatus = {
      ...baseStatus,
      frequency: 'daily',
      nextRunAt: '2026-07-15T12:00:00.000Z',
    };
    const updateBackupSchedule = vi.fn().mockResolvedValue({ success: true, status: dailyStatus });
    installElectron({ updateBackupSchedule });
    renderPanel();

    expect(await screen.findByTestId('backup-destination')).toHaveTextContent(
      '/tmp/puntovivo/backups/tenant-a'
    );
    await user.selectOptions(screen.getByLabelText(/snapshot frequency/i), 'daily');
    await user.click(screen.getByRole('button', { name: /save schedule/i }));

    expect(updateBackupSchedule).toHaveBeenCalledWith({ frequency: 'daily' });
    expect(screen.getByLabelText(/snapshot frequency/i)).toHaveValue('daily');
    expect(screen.getByText(/snapshot schedule saved/i)).toBeInTheDocument();
  });

  it('creates a snapshot now and refreshes its freshness evidence', async () => {
    const user = userEvent.setup();
    const completed: BackupScheduleStatus = {
      ...baseStatus,
      frequency: 'daily',
      lastAttemptAt: '2026-07-14T12:00:00.000Z',
      lastSuccessAt: '2026-07-14T12:00:02.000Z',
      nextRunAt: '2026-07-15T12:00:02.000Z',
      lastPath: '/tmp/puntovivo/backups/tenant-a/puntovivo-backup.zip',
      lastSizeBytes: 1_572_864,
    };
    const runBackupSnapshotNow = vi.fn().mockResolvedValue({ success: true, status: completed });
    const onSnapshotCreated = vi.fn();
    installElectron({ runBackupSnapshotNow });
    renderPanel({ onSnapshotCreated });

    await screen.findByText(/not created yet/i);
    await user.click(screen.getByRole('button', { name: /create snapshot now/i }));

    expect(runBackupSnapshotNow).toHaveBeenCalledTimes(1);
    expect(onSnapshotCreated).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('backup-last-success')).not.toHaveTextContent(/not created yet/i);
    expect(screen.getByText('1.5 MB')).toBeInTheDocument();
    expect(screen.getByText(/encrypted snapshot created/i)).toBeInTheDocument();
  });

  it('keeps cancellation silent when the native folder picker closes', async () => {
    const user = userEvent.setup();
    const chooseBackupScheduleDestination = vi
      .fn()
      .mockResolvedValue({ success: false, cancelled: true });
    installElectron({ chooseBackupScheduleDestination });
    renderPanel();

    await screen.findByTestId('backup-destination');
    await user.click(screen.getByRole('button', { name: /choose folder/i }));

    expect(chooseBackupScheduleDestination).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
