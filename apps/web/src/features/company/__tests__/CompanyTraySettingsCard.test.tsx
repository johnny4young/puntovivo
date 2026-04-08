import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { CompanyTraySettingsCard } from '../CompanyTraySettingsCard';

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

describe('CompanyTraySettingsCard', () => {
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
    renderWithQueryClient(<CompanyTraySettingsCard />);

    expect(
      screen.getByText(/tray settings are available in the Electron desktop app/i)
    ).toBeInTheDocument();
  });

  it('loads and updates tray settings', async () => {
    const user = userEvent.setup();
    const updateTraySettings = vi.fn().mockResolvedValue({
      enabled: true,
      closeToTray: true,
    });

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getTraySettings: vi.fn().mockResolvedValue({
        enabled: true,
        closeToTray: false,
      }),
      updateTraySettings,
      getThemePreference: vi.fn(),
      updateThemePreference: vi.fn(),
      getReceiptPrintSettings: vi.fn(),
      updateReceiptPrintSettings: vi.fn(),
      createDatabaseBackup: vi.fn(),
      restoreDatabaseBackup: vi.fn(),
      printReceipt: vi.fn(),
    };

    renderWithQueryClient(<CompanyTraySettingsCard />);

    const closeToTrayToggle = await screen.findByRole('checkbox', {
      name: /close window to tray/i,
    });
    expect(closeToTrayToggle).not.toBeChecked();

    await user.click(closeToTrayToggle);

    await waitFor(() => {
      expect(updateTraySettings).toHaveBeenCalledWith({
        enabled: true,
        closeToTray: true,
      });
    });
  });
});
