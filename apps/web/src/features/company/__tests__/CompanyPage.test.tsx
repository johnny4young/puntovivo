/**
 * ENG-045 — CompanyPage tab behavior.
 *
 * Covers the segmented-control TAB layout that replaces the
 * stacked-grid of admin-only cards. Heavy children (CompanyForm,
 * CompanyLocaleSettingsCard, CompanyAISettingsCard, CompanyMxFiscalCard, …)
 * are mocked
 * to keep the focus on:
 *  - admin sees the tab nav and the active panel
 *  - URL `?tab=ai` deep-links into the AI panel (used by
 *    AnomalyDetectionCard's "Activa la IA" CTA)
 *  - clicking a tab updates aria-selected and the URL
 *  - non-admin users see no tabs (only company form + logos)
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    companies: {
      getCurrent: {
        useQuery: () => ({
          data: { id: 'co-1', name: 'Tienda Demo', taxId: '900000000' },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      upsert: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
    },
    useUtils: () => ({
      companies: { getCurrent: { setData: vi.fn() } },
    }),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u-1', name: 'Admin', email: 'a@b.co', role: 'admin' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// Stub each child card with a data-testid so we can assert which tab
// panel rendered without exercising their full implementations.
vi.mock('../CompanyAISettingsCard', () => ({
  CompanyAISettingsCard: () => <div data-testid="card-ai">AI</div>,
}));
vi.mock('../CompanyMxFiscalCard', () => ({
  CompanyMxFiscalCard: () => <div data-testid="card-fiscal">Fiscal</div>,
}));
vi.mock('../CompanyBackupCard', () => ({
  CompanyBackupCard: () => <div data-testid="card-backup">Backup</div>,
}));
vi.mock('../CompanyLocaleSettingsCard', () => ({
  CompanyLocaleSettingsCard: () => <div data-testid="card-locale">Locale</div>,
}));
vi.mock('../CompanyAutoUpdateCard', () => ({
  CompanyAutoUpdateCard: () => <div data-testid="card-autoupdate">AutoUpdate</div>,
}));
vi.mock('../CompanyLogoLibraryCard', () => ({
  CompanyLogoLibraryCard: () => <div data-testid="card-logos">Logos</div>,
}));
vi.mock('../CompanyPrintSettingsCard', () => ({
  CompanyPrintSettingsCard: () => <div data-testid="card-print">Print</div>,
}));
vi.mock('../CompanySyncCard', () => ({
  CompanySyncCard: () => <div data-testid="card-sync">Sync</div>,
}));
vi.mock('../CompanyThemeSettingsCard', () => ({
  CompanyThemeSettingsCard: () => <div data-testid="card-theme">Theme</div>,
}));
vi.mock('../CompanyTraySettingsCard', () => ({
  CompanyTraySettingsCard: () => <div data-testid="card-tray">Tray</div>,
}));

// Import after mocks so the page picks up the stubbed children.
import { CompanyPage } from '../CompanyPage';

describe('CompanyPage tab behavior', () => {
  it('renders the segmented-control with six tabs and lands on General by default', () => {
    render(<CompanyPage />);

    // Tab list is present and exposes the six canonical tabs.
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(screen.getByTestId('company-tab-general')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('company-tab-ai')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('company-tab-fiscal')).toHaveAttribute('aria-selected', 'false');

    // General tab content visible: form fields + logo library card.
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
    expect(screen.getByTestId('card-logos')).toBeInTheDocument();

    // AI / Locale / Data / Device / Fiscal cards must NOT be in the DOM yet.
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-locale')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-sync')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-theme')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-fiscal')).not.toBeInTheDocument();
  });

  it('honors ?tab=ai in the URL and lands on the AI panel directly', () => {
    render(<CompanyPage />, { initialEntries: ['/company?tab=ai'] });

    expect(screen.getByTestId('company-tab-ai')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('card-ai')).toBeInTheDocument();
    // General-tab content should NOT render simultaneously.
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
  });

  it('switches active tab and panel content when the user clicks another tab', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await user.click(screen.getByTestId('company-tab-data'));

    expect(screen.getByTestId('company-tab-data')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('company-tab-general')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('card-sync')).toBeInTheDocument();
    expect(screen.getByTestId('card-backup')).toBeInTheDocument();
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
  });

  it('renders the device tab with all four device cards', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await user.click(screen.getByTestId('company-tab-device'));

    expect(screen.getByTestId('card-theme')).toBeInTheDocument();
    expect(screen.getByTestId('card-tray')).toBeInTheDocument();
    expect(screen.getByTestId('card-print')).toBeInTheDocument();
    expect(screen.getByTestId('card-autoupdate')).toBeInTheDocument();
  });

  it('renders the Locale tab with only the locale card', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await user.click(screen.getByTestId('company-tab-locale'));

    expect(screen.getByTestId('card-locale')).toBeInTheDocument();
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
  });

  it('renders the Fiscal tab with only the fiscal card', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await user.click(screen.getByTestId('company-tab-fiscal'));

    expect(screen.getByTestId('card-fiscal')).toBeInTheDocument();
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
  });
});

describe('CompanyPage non-admin behavior', () => {
  // Re-mock useAuth in a sibling describe via vi.hoisted is complex;
  // instead drive the role via a ?role= sentinel the mock honors. To
  // avoid that overhead we test non-admin in a dedicated nested
  // describe where we re-stub the auth mock for this block only.
  it('hides the tab nav when the user is not admin', async () => {
    vi.resetModules();
    vi.doMock('@/features/auth/AuthProvider', () => ({
      useAuth: () => ({
        user: { id: 'u-2', name: 'Cashier', email: 'c@b.co', role: 'cashier' },
      }),
    }));
    const mod = await import('../CompanyPage');
    const Reloaded = mod.CompanyPage;
    render(<Reloaded />);

    // No tablist rendered for non-admin.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    // Form + logos still visible.
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
    expect(screen.getByTestId('card-logos')).toBeInTheDocument();
    // Admin-only cards must be absent.
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-locale')).not.toBeInTheDocument();
  });
});
