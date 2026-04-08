import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { CompanyPrintSettingsCard } from '../CompanyPrintSettingsCard';

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

describe('CompanyPrintSettingsCard', () => {
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
    renderWithQueryClient(<CompanyPrintSettingsCard />);

    expect(
      screen.getByText(/available in the Electron desktop app/i)
    ).toBeInTheDocument();
  });

  it('loads and updates receipt print settings', async () => {
    const user = userEvent.setup();
    const updateReceiptPrintSettings = vi.fn().mockResolvedValue({
      silent: true,
      printBackground: true,
    });

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getThemePreference: vi.fn(),
      updateThemePreference: vi.fn(),
      getReceiptPrintSettings: vi.fn().mockResolvedValue({
        silent: false,
        printBackground: true,
      }),
      updateReceiptPrintSettings,
      createDatabaseBackup: vi.fn(),
      restoreDatabaseBackup: vi.fn(),
      printReceipt: vi.fn(),
    };

    renderWithQueryClient(<CompanyPrintSettingsCard />);

    const silentPrinting = await screen.findByRole('checkbox', { name: /silent printing/i });
    expect(silentPrinting).not.toBeChecked();

    await user.click(silentPrinting);

    await waitFor(() => {
      expect(updateReceiptPrintSettings).toHaveBeenCalledWith({
        silent: true,
        printBackground: true,
      });
    });
  });
});
