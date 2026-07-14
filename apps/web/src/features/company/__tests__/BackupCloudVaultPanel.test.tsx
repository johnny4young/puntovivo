import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import type { BackupCloudVaultStatus, ElectronAPI } from '@/types/electron';
import { BackupCloudVaultPanel } from '../BackupCloudVaultPanel';

const EMPTY_STATUS: BackupCloudVaultStatus = {
  configured: false,
  secureStorageAvailable: true,
  endpoint: null,
  region: null,
  bucket: null,
  prefix: null,
  forcePathStyle: false,
  accessKeyHint: null,
  configuredAt: null,
  updatedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastObjectKey: null,
  lastError: null,
  inProgress: false,
};

const CONFIGURED_STATUS: BackupCloudVaultStatus = {
  ...EMPTY_STATUS,
  configured: true,
  endpoint: 'https://objects.example.test',
  region: 'auto',
  bucket: 'merchant-backups',
  prefix: 'puntovivo/production',
  forcePathStyle: true,
  accessKeyHint: '••••1234',
  configuredAt: '2026-07-14T12:00:00.000Z',
  updatedAt: '2026-07-14T12:00:00.000Z',
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
    getBackupCloudVaultStatus: vi.fn().mockResolvedValue({
      success: true,
      status: EMPTY_STATUS,
    }),
    configureBackupCloudVault: vi.fn().mockResolvedValue({
      success: true,
      status: CONFIGURED_STATUS,
    }),
    disconnectBackupCloudVault: vi.fn().mockResolvedValue({
      success: true,
      status: EMPTY_STATUS,
    }),
    testBackupCloudVault: vi.fn().mockResolvedValue({
      success: true,
      status: CONFIGURED_STATUS,
    }),
    ...overrides,
  };
}

function renderPanel(props: React.ComponentProps<typeof BackupCloudVaultPanel> = {}) {
  return render(
    <ToastProvider>
      <BackupCloudVaultPanel {...props} />
    </ToastProvider>
  );
}

describe('BackupCloudVaultPanel (ENG-136c)', () => {
  beforeEach(() => {
    delete window.electron;
  });

  afterEach(() => {
    delete window.electron;
  });

  it('shows an explicit upgrade state outside the supported desktop bridge', () => {
    renderPanel();

    expect(
      screen.getByText(/update the desktop app to configure cloud backup replication/i)
    ).toBeInTheDocument();
  });

  it('renders only redacted metadata for an existing vault', async () => {
    installElectron({
      getBackupCloudVaultStatus: vi.fn().mockResolvedValue({
        success: true,
        status: CONFIGURED_STATUS,
      }),
    });
    renderPanel();

    expect(await screen.findByTestId('backup-cloud-connected-badge')).toHaveTextContent(
      /connected/i
    );
    expect(screen.getByText('merchant-backups')).toBeInTheDocument();
    expect(screen.getByText('••••1234')).toBeInTheDocument();
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret access key/i)).not.toBeInTheDocument();
  });

  it('saves write-only credentials, verifies the bucket and clears the form', async () => {
    const user = userEvent.setup();
    const configureBackupCloudVault = vi.fn().mockResolvedValue({
      success: true,
      status: CONFIGURED_STATUS,
    });
    const verifiedStatus: BackupCloudVaultStatus = {
      ...CONFIGURED_STATUS,
      lastAttemptAt: '2026-07-14T12:00:01.000Z',
      lastSuccessAt: '2026-07-14T12:00:01.000Z',
      lastObjectKey: 'puntovivo/production/tenant-a/.puntovivo-connection-test',
      updatedAt: '2026-07-14T12:00:01.000Z',
    };
    const testBackupCloudVault = vi.fn().mockResolvedValue({
      success: true,
      status: verifiedStatus,
    });
    installElectron({ configureBackupCloudVault, testBackupCloudVault });
    renderPanel();

    await screen.findByTestId('backup-cloud-vault-form');
    await user.type(screen.getByLabelText(/s3 endpoint/i), 'https://objects.example.test');
    await user.clear(screen.getByLabelText(/^region$/i));
    await user.type(screen.getByLabelText(/^region$/i), 'auto');
    await user.type(screen.getByLabelText(/^bucket$/i), 'merchant-backups');
    await user.clear(screen.getByLabelText(/object prefix/i));
    await user.type(screen.getByLabelText(/object prefix/i), 'puntovivo/production');
    await user.type(screen.getByLabelText(/access key id/i), 'ACCESS1234');
    await user.type(screen.getByLabelText(/secret access key/i), 'write-only-secret');
    await user.click(screen.getByRole('button', { name: /save and test/i }));

    expect(configureBackupCloudVault).toHaveBeenCalledWith({
      endpoint: 'https://objects.example.test',
      region: 'auto',
      bucket: 'merchant-backups',
      prefix: 'puntovivo/production',
      forcePathStyle: true,
      accessKeyId: 'ACCESS1234',
      secretAccessKey: 'write-only-secret',
    });
    expect(testBackupCloudVault).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/cloud vault saved and verified/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/secret access key/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('backup-cloud-last-object')).toHaveTextContent(
      'puntovivo/production/tenant-a/.puntovivo-connection-test'
    );
  });

  it('keeps the persisted redacted state available when the connection probe fails', async () => {
    const user = userEvent.setup();
    installElectron({
      testBackupCloudVault: vi.fn().mockResolvedValue({
        success: false,
        status: { ...CONFIGURED_STATUS, lastError: 'connection_failed' },
        error: 'connection_failed',
      }),
    });
    renderPanel();

    await screen.findByTestId('backup-cloud-vault-form');
    await user.type(screen.getByLabelText(/s3 endpoint/i), 'https://objects.example.test');
    await user.clear(screen.getByLabelText(/^region$/i));
    await user.type(screen.getByLabelText(/^region$/i), 'auto');
    await user.type(screen.getByLabelText(/^bucket$/i), 'merchant-backups');
    await user.type(screen.getByLabelText(/access key id/i), 'ACCESS1234');
    await user.type(screen.getByLabelText(/secret access key/i), 'write-only-secret');
    await user.click(screen.getByRole('button', { name: /save and test/i }));

    expect(await screen.findByTestId('backup-cloud-connected-badge')).toBeInTheDocument();
    expect(screen.getByText('••••1234')).toBeInTheDocument();
    expect(screen.queryByLabelText(/secret access key/i)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/cloud write test failed/i);
  });

  it('disconnects only after explicit confirmation', async () => {
    const user = userEvent.setup();
    const disconnectBackupCloudVault = vi.fn().mockResolvedValue({
      success: true,
      status: EMPTY_STATUS,
    });
    installElectron({
      getBackupCloudVaultStatus: vi.fn().mockResolvedValue({
        success: true,
        status: CONFIGURED_STATUS,
      }),
      disconnectBackupCloudVault,
    });
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /^disconnect$/i }));
    expect(disconnectBackupCloudVault).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /disconnect vault/i }));

    expect(disconnectBackupCloudVault).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/cloud vault disconnected/i)).toBeInTheDocument();
    expect(screen.getByTestId('backup-cloud-vault-form')).toBeInTheDocument();
  });

  it('disables credential storage when the OS keychain cannot seal secrets', async () => {
    installElectron({
      getBackupCloudVaultStatus: vi.fn().mockResolvedValue({
        success: true,
        status: { ...EMPTY_STATUS, secureStorageAvailable: false },
      }),
    });
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent(/keychain is unavailable/i);
    expect(screen.getByRole('button', { name: /save and test/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save and test/i })).toHaveAttribute(
      'aria-describedby',
      'backup-cloud-secure-storage-alert'
    );
  });

  it('disables connection tests when an existing vault cannot be unsealed', async () => {
    installElectron({
      getBackupCloudVaultStatus: vi.fn().mockResolvedValue({
        success: true,
        status: { ...CONFIGURED_STATUS, secureStorageAvailable: false },
      }),
    });
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent(/keychain is unavailable/i);
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test connection/i })).toHaveAttribute(
      'aria-describedby',
      'backup-cloud-secure-storage-alert'
    );
  });

  it('refreshes cloud evidence after a local snapshot completes', async () => {
    const snapshotStatus: BackupCloudVaultStatus = {
      ...CONFIGURED_STATUS,
      lastSuccessAt: '2026-07-14T12:00:02.000Z',
      lastObjectKey: 'puntovivo/production/tenant-a/puntovivo-backup-20260714.zip',
    };
    const getBackupCloudVaultStatus = vi
      .fn()
      .mockResolvedValueOnce({ success: true, status: CONFIGURED_STATUS })
      .mockResolvedValueOnce({ success: true, status: snapshotStatus });
    installElectron({ getBackupCloudVaultStatus });
    const view = renderPanel({ refreshKey: 0 });

    await screen.findByTestId('backup-cloud-connected-badge');
    view.rerender(
      <ToastProvider>
        <BackupCloudVaultPanel refreshKey={1} />
      </ToastProvider>
    );

    expect(await screen.findByTestId('backup-cloud-last-object')).toHaveTextContent(
      'puntovivo-backup-20260714.zip'
    );
    expect(getBackupCloudVaultStatus).toHaveBeenCalledTimes(2);
  });

  it('preserves a write-only replacement draft while cloud evidence refreshes', async () => {
    const user = userEvent.setup();
    const refreshedStatus: BackupCloudVaultStatus = {
      ...CONFIGURED_STATUS,
      lastObjectKey: 'puntovivo/production/tenant-a/puntovivo-backup-20260714.zip',
    };
    const getBackupCloudVaultStatus = vi
      .fn()
      .mockResolvedValueOnce({ success: true, status: CONFIGURED_STATUS })
      .mockResolvedValueOnce({ success: true, status: refreshedStatus });
    installElectron({ getBackupCloudVaultStatus });
    const view = renderPanel({ refreshKey: 0 });

    await user.click(await screen.findByRole('button', { name: /replace configuration/i }));
    await user.type(screen.getByLabelText(/access key id/i), 'DRAFT1234');
    await user.type(screen.getByLabelText(/secret access key/i), 'draft-write-only-secret');
    view.rerender(
      <ToastProvider>
        <BackupCloudVaultPanel refreshKey={1} />
      </ToastProvider>
    );

    expect(await screen.findByDisplayValue('DRAFT1234')).toBeInTheDocument();
    expect(screen.getByLabelText(/secret access key/i)).toHaveValue('draft-write-only-secret');
    expect(getBackupCloudVaultStatus).toHaveBeenCalledTimes(2);
  });
});
