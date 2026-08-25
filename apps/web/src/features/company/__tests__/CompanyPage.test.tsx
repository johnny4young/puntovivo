/**
 * CompanyPage tab behavior.
 *
 * Covers the progressive Setup nav (guided readiness as the admin
 * landing + every expert panel behind one Advanced disclosure).
 * Heavy children (CompanyForm,
 * CompanyLocaleSettingsCard, CompanyAISettingsCard, CompanyMxFiscalCard, …)
 * are mocked
 * to keep the focus on:
 * - admin sees the guided entry and can disclose advanced settings
 * - URL `?tab=ai` deep-links into the AI panel (used by
 * AnomalyDetectionCard's "Activa la IA" CTA)
 * - clicking a tab updates aria-current and the URL
 * - non-admin users see no nav (only company form + logos)
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import { render } from '@/test/utils';
import { assertNoA11yViolations } from '@/test/a11y';

// Mock countryCode mutable para que cada test pueda flippar el
// dispatch del tab Fiscal entre MX / CL / CO / unsupported sin re-mocks.
// `null` simula el estado loading del locale query.
let mockCountryCode: 'MX' | 'CL' | 'CO' | 'US' | null = 'CO';

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
    tenantLocale: {
      get: {
        useQuery: () => ({
          data: mockCountryCode === null ? undefined : { countryCode: mockCountryCode },
          isLoading: mockCountryCode === null,
          error: null,
          refetch: vi.fn(),
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
  CompanyMxFiscalCard: () => <div data-testid="card-fiscal-mx">Fiscal MX</div>,
}));
vi.mock('../CompanyClFiscalCard', () => ({
  CompanyClFiscalCard: () => <div data-testid="card-fiscal-cl">Fiscal CL</div>,
}));
vi.mock('../CompanyCoFiscalCard', () => ({
  CompanyCoFiscalCard: () => <div data-testid="card-fiscal-co">Fiscal CO</div>,
}));
vi.mock('../CompanyBackupCard', () => ({
  CompanyBackupCard: ({ focusRestore = false }: { focusRestore?: boolean }) => (
    <div data-focus-restore={String(focusRestore)} data-testid="card-backup">
      Backup
    </div>
  ),
}));
vi.mock('../CompanyDataRetentionCard', () => ({
  CompanyDataRetentionCard: () => <div data-testid="card-retention">Retention</div>,
}));
vi.mock('../CompanyLocaleSettingsCard', () => ({
  CompanyLocaleSettingsCard: () => <div data-testid="card-locale">Locale</div>,
}));
vi.mock('../CompanyLossPreventionCard', () => ({
  CompanyLossPreventionCard: () => <div data-testid="card-loss-prevention">Loss prevention</div>,
}));
vi.mock('../CompanyAutoUpdateCard', () => ({
  CompanyAutoUpdateCard: () => <div data-testid="card-autoupdate">AutoUpdate</div>,
}));
vi.mock('../CompanyCashCloseSettingsCard', () => ({
  CompanyCashCloseSettingsCard: () => <div data-testid="card-cash-close">CashClose</div>,
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
vi.mock('../CompanyModulesCard', () => ({
  CompanyModulesCard: () => <div data-testid="card-modules">Modules</div>,
}));
// Stub the readiness card too; the real implementation
// reaches the trpc surface and the rest of this suite already mocks
// the trpc layer at the page level.
vi.mock('../CompanyReadinessCard', () => ({
  CompanyReadinessCard: () => <div data-testid="card-readiness">Readiness</div>,
}));
// Stub the telemetry card. The CompanyPage tab test does
// not exercise the toggle round-trip; the dedicated
// `CompanyTelemetryCard.test.tsx` pins that contract.
vi.mock('../CompanyTelemetryCard', () => ({
  CompanyTelemetryCard: () => <div data-testid="card-telemetry">Telemetry</div>,
}));

// Import after mocks so the page picks up the stubbed children.
import { CompanyPage } from '../CompanyPage';

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>;
}

async function openAdvancedSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('company-advanced-toggle'));
  expect(screen.getByTestId('company-advanced-settings')).toBeInTheDocument();
}

describe('CompanyPage tab behavior', () => {
  beforeEach(() => {
    mockCountryCode = 'CO';
  });

  it('renders the guided setup as the only visible admin landing', async () => {
    render(<CompanyPage />);

    expect(screen.getByTestId('company-tab-readiness')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('company-advanced-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('company-advanced-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-tab-general')).not.toBeInTheDocument();
    expect(await screen.findByTestId('card-readiness')).toBeInTheDocument();
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
  });

  it('reveals every legacy configuration destination under Advanced settings', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);

    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Billing & payments')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    for (const key of [
      'general',
      'controls',
      'locale',
      'fiscal',
      'payments',
      'modules',
      'ai',
      'data',
      'device',
    ]) {
      expect(screen.getByTestId(`company-tab-${key}`)).not.toHaveAttribute('aria-current', 'page');
    }
    // the restaurant tab is dine-in scoped: a tenant without the
    // module never sees the entry (the store defaults it off here).
    expect(screen.queryByTestId('company-tab-restaurant')).not.toBeInTheDocument();
  });

  it('honors ?tab=ai in the URL and lands on the AI panel directly', () => {
    render(<CompanyPage />, { initialEntries: ['/company?tab=ai'] });

    expect(screen.getByTestId('company-advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('company-tab-ai')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('card-ai')).toBeInTheDocument();
    // Readiness is no longer the current item.
    expect(screen.getByTestId('company-tab-readiness')).not.toHaveAttribute('aria-current', 'page');
    // General-tab content should NOT render simultaneously.
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
  });

  it('returns to the guided landing when Advanced settings is collapsed', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />, { initialEntries: ['/company?tab=ai'] });

    await user.click(screen.getByTestId('company-advanced-toggle'));

    expect(screen.getByTestId('company-tab-readiness')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('company-advanced-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('company-advanced-settings')).not.toBeInTheDocument();
    expect(await screen.findByTestId('card-readiness')).toBeInTheDocument();
  });

  it('switches active item and panel content when the user clicks another tab', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-data'));

    expect(screen.getByTestId('company-tab-data')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('company-tab-readiness')).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('card-sync')).toBeInTheDocument();
    expect(await screen.findByTestId('card-backup')).toBeInTheDocument();
    expect(screen.getByTestId('card-retention')).toBeInTheDocument();
    expect(screen.queryByLabelText(/company name/i)).not.toBeInTheDocument();
  });

  it.each([
    ['data', 'telemetry', 'company-telemetry-target', 'Crash, performance & usability telemetry'],
    ['device', 'app-updates', 'company-app-updates-target', 'App Updates'],
  ])('focuses the exact %s/%s recovery destination', async (tab, focus, testId, accessibleName) => {
    render(<CompanyPage />, {
      initialEntries: [`/company?tab=${tab}&focus=${focus}`],
    });

    const target = await screen.findByTestId(testId);
    expect(target).toHaveFocus();
    expect(target).toHaveAccessibleName(accessibleName);
  });

  it('clears a recovery focus intent when the administrator changes tabs', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CompanyPage />
        <LocationProbe />
      </>,
      { initialEntries: ['/company?tab=data&focus=backup-restore'] }
    );

    await screen.findByTestId('card-backup');
    await user.click(screen.getByTestId('company-tab-device'));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/company?tab=device');
  });

  it('passes the backup-restore intent to the lazy backup surface', async () => {
    render(<CompanyPage />, {
      initialEntries: ['/company?tab=data&focus=backup-restore'],
    });

    expect(await screen.findByTestId('card-backup')).toHaveAttribute('data-focus-restore', 'true');
  });

  it('renders the device tab with all four device cards', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-device'));

    expect(screen.getByTestId('card-theme')).toBeInTheDocument();
    expect(screen.getByTestId('card-tray')).toBeInTheDocument();
    expect(screen.getByTestId('card-print')).toBeInTheDocument();
    expect(screen.getByTestId('card-autoupdate')).toBeInTheDocument();
  });

  it('renders the Locale tab with only the locale card', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-locale'));

    expect(screen.getByTestId('card-locale')).toBeInTheDocument();
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
  });

  it('renders loss-prevention settings from the Controls tab', async () => {
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-controls'));

    expect(screen.getByTestId('company-tab-controls')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('card-loss-prevention')).toBeInTheDocument();
    expect(screen.queryByTestId('card-locale')).not.toBeInTheDocument();
  });

  it('renders the Fiscal tab with the MX card when tenant countryCode is MX', async () => {
    mockCountryCode = 'MX';
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-fiscal'));

    expect(screen.getByTestId('card-fiscal-mx')).toBeInTheDocument();
    expect(screen.queryByTestId('card-fiscal-cl')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
  });

  it('renders the Fiscal tab with the CL card when tenant countryCode is CL', async () => {
    mockCountryCode = 'CL';
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-fiscal'));

    expect(screen.getByTestId('card-fiscal-cl')).toBeInTheDocument();
    expect(screen.queryByTestId('card-fiscal-mx')).not.toBeInTheDocument();
  });

  it('renders the CO fiscal card under the Fiscal tab when tenant countryCode is CO', async () => {
    mockCountryCode = 'CO';
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-fiscal'));

    // Neither MX nor CL render; the real CO config card does (
    // replaced the old "coming soon" placeholder).
    expect(screen.queryByTestId('card-fiscal-mx')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-fiscal-cl')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-fiscal-co')).toBeInTheDocument();
  });

  it('does not fall back to the CO fiscal card while tenant locale is loading', async () => {
    mockCountryCode = null;
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-fiscal'));

    expect(screen.queryByTestId('card-fiscal-co')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-fiscal-mx')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-fiscal-cl')).not.toBeInTheDocument();
    expect(screen.getByText(/Country-specific fiscal configuration/i)).toBeInTheDocument();
  });

  it('renders the unsupported-country fiscal message instead of a fallback card', async () => {
    mockCountryCode = 'US';
    const user = userEvent.setup();
    render(<CompanyPage />);

    await openAdvancedSettings(user);
    await user.click(screen.getByTestId('company-tab-fiscal'));

    expect(screen.queryByTestId('card-fiscal-co')).not.toBeInTheDocument();
    expect(screen.getByText(/Electronic invoicing is not available here yet/i)).toBeInTheDocument();
    expect(screen.getByText(/There is no fiscal pack for US yet/i)).toBeInTheDocument();
  });

  it('has no serious accessibility violations in the progressive Setup nav', async () => {
    const { container } = render(<CompanyPage />);
    await screen.findByTestId('card-readiness');
    await assertNoA11yViolations(container);
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
    // resetModules rebuilds the @/i18n singleton with only the
    // bootstrap namespaces inlined; re-prime the fresh instance so the
    // re-imported CompanyPage does not suspend on its feature namespaces.
    const { registerAllNamespacesForTest } = await import('@/test/i18nTestResources');
    registerAllNamespacesForTest();
    const mod = await import('../CompanyPage');
    const Reloaded = mod.CompanyPage;
    render(<Reloaded />);

    // no grouped Setup nav rendered for non-admin (the
    // readiness landing + category groups are admin-only).
    expect(screen.queryByTestId('company-tab-readiness')).not.toBeInTheDocument();
    // Form + logos still visible.
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
    expect(screen.getByTestId('card-logos')).toBeInTheDocument();
    // Admin-only cards must be absent.
    expect(screen.queryByTestId('card-ai')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-locale')).not.toBeInTheDocument();
  });
});
