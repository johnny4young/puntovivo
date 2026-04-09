import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback/ToastProvider';
import { ThemeProvider } from '@/components/feedback/ThemeProvider';
import { CompanyThemeSettingsCard } from '../CompanyThemeSettingsCard';

function renderWithProviders(ui: ReactElement) {
  return render(
    <ToastProvider>
      <ThemeProvider>{ui}</ThemeProvider>
    </ToastProvider>
  );
}

describe('CompanyThemeSettingsCard', () => {
  const originalElectron = window.electron;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.electron;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
  });

  afterEach(() => {
    if (originalElectron) {
      window.electron = originalElectron;
    } else {
      delete window.electron;
    }

    window.matchMedia = originalMatchMedia;
  });

  it('stores browser theme preference locally when Electron is unavailable', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CompanyThemeSettingsCard />);

    await user.click(screen.getByRole('button', { name: /dark/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem('open-yojob-theme-preference')).toBe('dark');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('loads and updates the desktop theme preference', async () => {
    const user = userEvent.setup();
    const updateThemePreference = vi.fn().mockResolvedValue('dark');

    window.electron = {
      getAppVersion: vi.fn(),
      getAppPath: vi.fn(),
      getServerUrl: vi.fn(),
      getAutoUpdateStatus: vi.fn(),
      checkForAppUpdates: vi.fn(),
      restartToApplyAppUpdate: vi.fn(),
      getTraySettings: vi.fn(),
      updateTraySettings: vi.fn(),
      getThemePreference: vi.fn().mockResolvedValue('system'),
      updateThemePreference,
      getReceiptPrintSettings: vi.fn(),
      updateReceiptPrintSettings: vi.fn(),
      createDatabaseBackup: vi.fn(),
      restoreDatabaseBackup: vi.fn(),
      printReceipt: vi.fn(),
    };

    renderWithProviders(<CompanyThemeSettingsCard />);

    await screen.findByText(/active appearance:/i);
    await user.click(screen.getByRole('button', { name: /dark/i }));

    await waitFor(() => {
      expect(updateThemePreference).toHaveBeenCalledWith('dark');
    });
  });
});
