import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { CompanyAutoUpdateCard } from '../CompanyAutoUpdateCard';

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

describe('CompanyAutoUpdateCard', () => {
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
    renderWithQueryClient(<CompanyAutoUpdateCard />);

    expect(screen.getByText(/available in the Electron desktop app/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();
  });

  it('loads updater status and triggers a manual check', async () => {
    const user = userEvent.setup();
    const checkForAppUpdates = vi.fn().mockResolvedValue({
      isAvailable: true,
      state: 'checking',
      currentVersion: '1.0.0',
      lastCheckedAt: '2026-04-08T15:00:00.000Z',
      releaseName: null,
      releaseNotes: null,
      releaseDate: null,
      updateUrl: null,
      error: null,
      reason: null,
    });

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getAutoUpdateStatus: vi.fn().mockResolvedValue({
        isAvailable: true,
        state: 'idle',
        currentVersion: '1.0.0',
        lastCheckedAt: '2026-04-08T14:00:00.000Z',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null,
        updateUrl: null,
        error: null,
        reason: null,
      }),
      checkForAppUpdates,
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
    };

    renderWithQueryClient(<CompanyAutoUpdateCard />);

    await screen.findByText(/up to date/i);
    await user.click(screen.getByRole('button', { name: /check for updates/i }));

    await waitFor(() => {
      expect(checkForAppUpdates).toHaveBeenCalledTimes(1);
    });
  });

  it('offers a release link (not a restart) in notify-only manual mode', async () => {
    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getAutoUpdateStatus: vi.fn().mockResolvedValue({
        isAvailable: true,
        state: 'available',
        installMode: 'manual',
        currentVersion: '1.0.0',
        lastCheckedAt: '2026-04-08T16:00:00.000Z',
        releaseName: 'v1.2.0',
        releaseNotes: 'Notify-only release',
        releaseDate: '2026-04-08T15:30:00.000Z',
        updateUrl: 'https://github.com/johnny4young/puntovivo/releases/tag/v1.2.0',
        error: null,
        reason: null,
      }),
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
    };

    renderWithQueryClient(<CompanyAutoUpdateCard />);

    const releaseLink = await screen.findByRole('link', { name: /view release/i });
    expect(releaseLink).toHaveAttribute(
      'href',
      'https://github.com/johnny4young/puntovivo/releases/tag/v1.2.0'
    );
    // Manual mode never offers an in-place restart/install.
    expect(screen.queryByRole('button', { name: /restart to install/i })).not.toBeInTheDocument();
  });

  it('restarts to install a downloaded update', async () => {
    const user = userEvent.setup();
    const restartToApplyAppUpdate = vi.fn().mockResolvedValue({ success: true });

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getAutoUpdateStatus: vi.fn().mockResolvedValue({
        isAvailable: true,
        state: 'downloaded',
        currentVersion: '1.0.0',
        lastCheckedAt: '2026-04-08T16:00:00.000Z',
        releaseName: 'v1.1.0',
        releaseNotes: 'Bug fixes',
        releaseDate: '2026-04-08T15:30:00.000Z',
        updateUrl: 'https://example.com/update.zip',
        error: null,
        reason: null,
      }),
      checkForAppUpdates: vi.fn(),
      restartToApplyAppUpdate,
      getTraySettings: vi.fn(),
      updateTraySettings: vi.fn(),
      getThemePreference: vi.fn(),
      updateThemePreference: vi.fn(),
      getReceiptPrintSettings: vi.fn(),
      updateReceiptPrintSettings: vi.fn(),
      createDatabaseBackup: vi.fn(),
      restoreDatabaseBackup: vi.fn(),
      printReceipt: vi.fn(),
    };

    renderWithQueryClient(<CompanyAutoUpdateCard />);

    await screen.findByText(/ready to install/i);
    const restartButton = screen.getByRole('button', { name: /restart to install/i });

    await waitFor(() => {
      expect(restartButton).toBeEnabled();
    });

    await user.click(restartButton);

    await waitFor(() => {
      expect(restartToApplyAppUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces the last version transition and an exact fleet rollback policy', async () => {
    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getAutoUpdateStatus: vi.fn().mockResolvedValue({
        isAvailable: true,
        state: 'checking',
        installMode: 'auto',
        currentVersion: '1.6.0',
        lastCheckedAt: '2026-07-15T16:00:00.000Z',
        lastUpdatedAt: '2026-07-14T14:00:00.000Z',
        rolloutMode: 'rollback',
        rolloutPercentage: 100,
        rolloutTargetVersion: '1.5.1',
        rolloutPolicyCheckedAt: '2026-07-15T16:00:00.000Z',
        releaseName: null,
        releaseNotes: null,
        releaseDate: null,
        updateUrl: null,
        error: null,
        reason: null,
      }),
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
    };

    renderWithQueryClient(<CompanyAutoUpdateCard />);

    expect(await screen.findByText('Rollback · 100%')).toBeInTheDocument();
    expect(screen.getByTestId('auto-update-rollback-policy')).toHaveTextContent(
      'Rollback is active for version 1.5.1'
    );
    const lastUpdatedMetric = screen.getByText('Last Updated').parentElement;
    expect(lastUpdatedMetric).toHaveTextContent('Jul 14, 2026');
    expect(lastUpdatedMetric).not.toHaveTextContent('Not yet');
  });
});
