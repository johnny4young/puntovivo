import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CompanyBackupCard } from '../CompanyBackupCard';

describe('CompanyBackupCard', () => {
  const originalElectron = window.electron;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.electron;
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    if (originalElectron) {
      window.electron = originalElectron;
    } else {
      delete window.electron;
    }

    window.confirm = originalConfirm;
  });

  it('shows desktop-only messaging when Electron APIs are unavailable', () => {
    render(<CompanyBackupCard />);

    expect(
      screen.getByText(/available in the Electron desktop app/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create backup/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /restore backup/i })).toBeDisabled();
  });

  it('creates a backup and shows the selected path', async () => {
    const user = userEvent.setup();

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      printReceipt: vi.fn(),
      restoreDatabaseBackup: vi.fn(),
      createDatabaseBackup: vi.fn().mockResolvedValue({
        success: true,
        cancelled: false,
        path: '/tmp/open-yojob-backup.db',
      }),
    };

    render(<CompanyBackupCard />);

    await user.click(screen.getByRole('button', { name: /create backup/i }));

    expect(window.electron.createDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/backup saved to \/tmp\/open-yojob-backup\.db/i)).toBeInTheDocument();
  });

  it('asks for confirmation before restoring a backup', async () => {
    const user = userEvent.setup();
    const restoreDatabaseBackup = vi.fn().mockResolvedValue({
      success: true,
      cancelled: false,
      path: '/tmp/open-yojob-backup.db',
    });

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      printReceipt: vi.fn(),
      createDatabaseBackup: vi.fn(),
      restoreDatabaseBackup,
    };

    render(<CompanyBackupCard />);

    await user.click(screen.getByRole('button', { name: /restore backup/i }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(restoreDatabaseBackup).toHaveBeenCalledTimes(1);
  });
});
