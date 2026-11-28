import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { AutoUpdateBanner } from '../AutoUpdateBanner';

function renderBanner() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AutoUpdateBanner />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function installElectron(status: Record<string, unknown>) {
  window.electron = {
    getAppVersion: vi.fn(),
    getAppPath: vi.fn(),
    getServerUrl: vi.fn(),
    getAutoUpdateStatus: vi.fn().mockResolvedValue(status),
    checkForAppUpdates: vi.fn().mockResolvedValue({ ...status, installReady: true }),
    restartToApplyAppUpdate: vi.fn().mockResolvedValue({ success: true }),
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
  return window.electron;
}

const STATUS = {
  isAvailable: true,
  state: 'downloaded',
  installMode: 'auto',
  currentVersion: '1.10.0',
  lastCheckedAt: null,
  lastUpdatedAt: null,
  downloadedVersion: '1.11.0',
  downloadedAt: '2026-08-28T12:00:00.000Z',
  updateFloorVersion: '1.10.0',
  rolloutMode: 'normal',
  rolloutPercentage: 10,
  rolloutTargetVersion: '1.11.0',
  rolloutPolicyCheckedAt: '2026-08-28T12:00:00.000Z',
  releaseName: 'Puntovivo 1.11.0',
  releaseNotes: null,
  releaseDate: null,
  updateUrl: null,
  error: null,
  reason: null,
};

describe('AutoUpdateBanner', () => {
  const originalElectron = window.electron;
  beforeEach(() => {
    window.localStorage.clear();
    delete window.electron;
  });
  afterEach(() => {
    window.localStorage.clear();
    if (originalElectron) window.electron = originalElectron;
    else delete window.electron;
  });

  it('reconfirms a persisted download instead of enabling restart immediately', async () => {
    const user = userEvent.setup();
    const electron = installElectron({ ...STATUS, installReady: false });
    renderBanner();

    expect(await screen.findByText(/downloaded previously/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart to install/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /verify download/i }));
    await waitFor(() => expect(electron.checkForAppUpdates).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /restart to install/i })).toBeEnabled();
  });

  it('restarts a verified update and remembers a version-scoped dismissal', async () => {
    const user = userEvent.setup();
    const electron = installElectron({ ...STATUS, installReady: true });
    renderBanner();
    await user.click(await screen.findByRole('button', { name: /restart to install/i }));
    await waitFor(() => expect(electron.restartToApplyAppUpdate).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /dismiss update notice/i }));
    expect(screen.queryByTestId('auto-update-banner')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('puntovivo:auto-update-banner:dismissed:1.11.0')).toBe('1');
  });

  it('updates live from main-process push events without polling every 30 s', async () => {
    let pushListener: ((status: Record<string, unknown>) => void) | undefined;
    const unsubscribe = vi.fn();
    const electron = installElectron({ ...STATUS, state: 'idle', downloadedVersion: null });
    electron.onAutoUpdateStatus = vi.fn(listener => {
      pushListener = listener as (status: Record<string, unknown>) => void;
      return unsubscribe;
    });

    const { unmount } = renderBanner();
    await waitFor(() => expect(electron.getAutoUpdateStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('auto-update-banner')).not.toBeInTheDocument();

    pushListener?.({ ...STATUS, installReady: true });
    expect(await screen.findByRole('button', { name: /restart to install/i })).toBeEnabled();
    expect(electron.getAutoUpdateStatus).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
