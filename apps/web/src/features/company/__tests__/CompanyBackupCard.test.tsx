import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { CompanyBackupCard } from '../CompanyBackupCard';

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('CompanyBackupCard', () => {
  const originalElectron = window.electron;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.electron;
  });

  afterEach(() => {
    if (originalElectron) {
      window.electron = originalElectron;
    } else {
      delete window.electron;
    }
  });

  it('shows desktop-only messaging when Electron APIs are unavailable', () => {
    renderWithToast(<CompanyBackupCard />);

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
      getAutoUpdateStatus: vi.fn(),
      checkForAppUpdates: vi.fn(),
      restartToApplyAppUpdate: vi.fn(),
      getTraySettings: vi.fn(),
      updateTraySettings: vi.fn(),
      getThemePreference: vi.fn(),
      updateThemePreference: vi.fn(),
      getReceiptPrintSettings: vi.fn(),
      updateReceiptPrintSettings: vi.fn(),
      printReceipt: vi.fn(),
      restoreDatabaseBackup: vi.fn(),
      createDatabaseBackup: vi.fn().mockResolvedValue({
        success: true,
        cancelled: false,
        path: '/tmp/puntovivo-backup.db',
      }),
    };

    renderWithToast(<CompanyBackupCard />);

    await user.click(screen.getByRole('button', { name: /create backup/i }));

    expect(window.electron.createDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/backup saved to \/tmp\/puntovivo-backup\.db/i)).toBeInTheDocument();
  });

  it('asks for confirmation before restoring a backup', async () => {
    const user = userEvent.setup();
    const restoreDatabaseBackup = vi.fn().mockResolvedValue({
      success: true,
      cancelled: false,
      path: '/tmp/puntovivo-backup.db',
    });

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
      printReceipt: vi.fn(),
      createDatabaseBackup: vi.fn(),
      restoreDatabaseBackup,
    };

    renderWithToast(<CompanyBackupCard />);

    await user.click(screen.getByRole('button', { name: /restore backup/i }));
    expect(screen.getByText(/restore database backup/i)).toBeInTheDocument();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /^restore backup$/i }));
    expect(restoreDatabaseBackup).toHaveBeenCalledTimes(1);
  });

  // ENG-167b — cross-device key prompt + admin key reveal.
  describe('cross-device restore key flow (ENG-167b)', () => {
    const FOREIGN_KEY = 'c'.repeat(64);

    function buildElectronStub(overrides: Partial<NonNullable<typeof window.electron>> = {}) {
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
        printReceipt: vi.fn(),
        createDatabaseBackup: vi.fn(),
        restoreDatabaseBackup: vi.fn(),
        provideRestoreKey: vi.fn(),
        cancelRestoreStaging: vi.fn().mockResolvedValue({ success: true }),
        getBackupEncryptionKey: vi.fn(),
        ...overrides,
      };
      return window.electron;
    }

    async function driveToKeyPrompt(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: /restore backup/i }));
      const confirm = screen.getByRole('dialog');
      await user.click(
        within(confirm).getByRole('button', { name: /^restore backup$/i })
      );
      return screen.findByTestId('backup-restore-key-input');
    }

    it('opens the key prompt when the bundle needs a foreign key and completes the restore', async () => {
      const user = userEvent.setup();
      const provideRestoreKey = vi.fn().mockResolvedValue({
        success: true,
        cancelled: false,
        path: '/tmp/foreign.zip',
      });
      buildElectronStub({
        restoreDatabaseBackup: vi.fn().mockResolvedValue({
          success: false,
          cancelled: false,
          needsKey: true,
          token: 'tok-1',
        }),
        provideRestoreKey,
      });

      renderWithToast(<CompanyBackupCard />);
      const input = await driveToKeyPrompt(user);

      await user.type(input, FOREIGN_KEY);
      await user.click(screen.getByTestId('backup-restore-key-submit'));

      expect(provideRestoreKey).toHaveBeenCalledWith('tok-1', FOREIGN_KEY);
      expect(
        screen.queryByTestId('backup-restore-key-input')
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/backup restored successfully/i)
      ).toBeInTheDocument();
    });

    it('rejects a malformed key client-side without calling the IPC', async () => {
      const user = userEvent.setup();
      const provideRestoreKey = vi.fn();
      buildElectronStub({
        restoreDatabaseBackup: vi.fn().mockResolvedValue({
          success: false,
          cancelled: false,
          needsKey: true,
          token: 'tok-2',
        }),
        provideRestoreKey,
      });

      renderWithToast(<CompanyBackupCard />);
      const input = await driveToKeyPrompt(user);

      await user.type(input, 'short-and-not-hex');
      await user.click(screen.getByTestId('backup-restore-key-submit'));

      expect(provideRestoreKey).not.toHaveBeenCalled();
      expect(
        screen.getByTestId('backup-restore-key-error')
      ).toHaveTextContent(/64 hexadecimal characters/i);
    });

    it('keeps the prompt open with the mismatch message when the key is wrong', async () => {
      const user = userEvent.setup();
      buildElectronStub({
        restoreDatabaseBackup: vi.fn().mockResolvedValue({
          success: false,
          cancelled: false,
          needsKey: true,
          token: 'tok-3',
        }),
        provideRestoreKey: vi.fn().mockResolvedValue({
          success: false,
          cancelled: false,
          needsKey: true,
          token: 'tok-3',
          error: 'That key does not open this backup.',
        }),
      });

      renderWithToast(<CompanyBackupCard />);
      const input = await driveToKeyPrompt(user);

      await user.type(input, FOREIGN_KEY);
      await user.click(screen.getByTestId('backup-restore-key-submit'));

      expect(screen.getByTestId('backup-restore-key-input')).toBeInTheDocument();
      expect(screen.getByTestId('backup-restore-key-error')).toHaveTextContent(
        /does not open this backup/i
      );
    });

    it('clears the waiting status banner and discards the staging when the key prompt is cancelled', async () => {
      const user = userEvent.setup();
      const cancelRestoreStaging = vi
        .fn()
        .mockResolvedValue({ success: true });
      buildElectronStub({
        restoreDatabaseBackup: vi.fn().mockResolvedValue({
          success: false,
          cancelled: false,
          needsKey: true,
          token: 'tok-4',
        }),
        cancelRestoreStaging,
      });

      renderWithToast(<CompanyBackupCard />);
      await driveToKeyPrompt(user);
      expect(
        screen.getByText(/needs the source device's key/i)
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      // Prompt gone AND the banner no longer claims an in-flight
      // restore waiting for its key.
      expect(
        screen.queryByTestId('backup-restore-key-input')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/needs the source device's key/i)
      ).not.toBeInTheDocument();
      expect(screen.getByText(/restore was cancelled/i)).toBeInTheDocument();
      // The staged copy on the main side is discarded immediately.
      expect(cancelRestoreStaging).toHaveBeenCalledWith('tok-4');
    });

    it('reveals the backup key only after the warning confirmation', async () => {
      const user = userEvent.setup();
      const getBackupEncryptionKey = vi.fn().mockResolvedValue({
        success: true,
        key: FOREIGN_KEY,
      });
      buildElectronStub({ getBackupEncryptionKey });

      renderWithToast(<CompanyBackupCard />);

      await user.click(screen.getByTestId('backup-reveal-key'));
      expect(getBackupEncryptionKey).not.toHaveBeenCalled();
      expect(screen.getByText(/anyone holding this key/i)).toBeInTheDocument();

      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: /reveal key/i }));

      expect(getBackupEncryptionKey).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('backup-revealed-key')).toHaveTextContent(
        FOREIGN_KEY
      );
    });
  });
});
