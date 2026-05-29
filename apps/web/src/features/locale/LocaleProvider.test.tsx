import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import {
  getActiveTenantLocale,
  setActiveTenantLocale,
} from '@/lib/utils';
import {
  LocaleSync,
  useResolvedLocale,
  __localeStoreForTests,
  type ResolvedLocale,
} from './LocaleProvider';

let mockIsAuthenticated = false;
let mockTenant: { id: string } | null = null;
let mockLocale: ResolvedLocale | undefined;

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
  }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: mockTenant,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    tenantLocale: {
      get: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => ({
          data: options.enabled ? mockLocale : undefined,
          isLoading: false,
        }),
      },
    },
  },
}));

const colombiaLocale: ResolvedLocale = {
  locale: 'es-CO',
  language: 'es',
  countryCode: 'CO',
  currency: 'COP',
  currencySymbol: '$',
  legalDecimals: 2,
  displayDecimals: 0,
  timezone: 'America/Bogota',
  firstDayOfWeek: 1,
  dateFormatShort: 'dd/MM/yyyy',
  localeOverride: null,
  currencyOverride: null,
  timezoneOverride: null,
  firstDayOfWeekOverride: null,
  uiLocaleReady: true,
  isFallback: false,
};

function LocaleProbe() {
  const resolved = useResolvedLocale();
  return <span>{resolved.locale}</span>;
}

describe('LocaleSync (ENG-171 store-backed locale)', () => {
  beforeEach(async () => {
    mockIsAuthenticated = false;
    mockTenant = null;
    mockLocale = undefined;
    setActiveTenantLocale(null);
    __localeStoreForTests.getState().reset();
    await i18n.changeLanguage('es');
  });

  it('does not push the fallback language into i18n while unauthenticated', async () => {
    setActiveTenantLocale({
      locale: 'en-US',
      currency: 'USD',
      displayDecimals: 2,
      timezone: 'America/New_York',
      dateFormatShort: 'MM/dd/yyyy',
    });

    render(
      <>
        <LocaleSync />
        <LocaleProbe />
      </>
    );

    // Store falls back to en-US while unauthenticated.
    expect(screen.getByText('en-US')).toBeInTheDocument();
    await waitFor(() => {
      expect(getActiveTenantLocale()).toBeNull();
    });
    expect(i18n.resolvedLanguage ?? i18n.language).toBe('es');
  });

  it('hydrates formatters and i18n from tenant locale after authentication', async () => {
    mockIsAuthenticated = true;
    mockTenant = { id: 'tenant-1' };
    mockLocale = colombiaLocale;
    await i18n.changeLanguage('en');

    render(
      <>
        <LocaleSync />
        <LocaleProbe />
      </>
    );

    expect(screen.getByText('es-CO')).toBeInTheDocument();
    await waitFor(() => {
      expect(getActiveTenantLocale()).toMatchObject({
        locale: 'es-CO',
        currency: 'COP',
        timezone: 'America/Bogota',
        dateFormatShort: 'dd/MM/yyyy',
      });
    });
    await waitFor(() => {
      expect(i18n.resolvedLanguage ?? i18n.language).toBe('es');
    });
  });

  it('resets the resolved locale to the fallback on logout', async () => {
    // First, authenticate and load Colombia.
    mockIsAuthenticated = true;
    mockTenant = { id: 'tenant-1' };
    mockLocale = colombiaLocale;
    const { rerender } = render(
      <>
        <LocaleSync />
        <LocaleProbe />
      </>
    );
    await waitFor(() => {
      expect(screen.getByText('es-CO')).toBeInTheDocument();
    });

    // Then drop the session and re-render: the unauth branch resets the
    // singleton + store so no stale cashier locale leaks.
    mockIsAuthenticated = false;
    mockTenant = null;
    mockLocale = undefined;
    rerender(
      <>
        <LocaleSync />
        <LocaleProbe />
      </>
    );
    await waitFor(() => {
      expect(screen.getByText('en-US')).toBeInTheDocument();
    });
    expect(getActiveTenantLocale()).toBeNull();
  });
});
