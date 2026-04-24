/**
 * ENG-017 — CompanyLocaleSettingsCard tests.
 *
 * Covers:
 * - Render with a minimal country/currency catalog mock.
 * - Country picker change drives the live-preview without a server
 *   round-trip (pure Intl formatting on the client).
 * - Save button invokes the mutation with the picked country.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const mutate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const mockCountries = [
  {
    code: 'CO',
    nameEn: 'Colombia',
    nameEs: 'Colombia',
    defaultLocale: 'es-CO',
    generalLocale: 'es',
    defaultCurrencyCode: 'COP',
    additionalCurrencyCodes: [],
    defaultTimezone: 'America/Bogota',
    firstDayOfWeek: 1,
    dateFormatShort: 'dd/MM/yyyy',
    dateFormatLong: 'd MMMM yyyy',
    taxIdTypesHint: ['CC', 'NIT'],
    uiLocaleReady: true,
  },
  {
    code: 'US',
    nameEn: 'United States',
    nameEs: 'Estados Unidos',
    defaultLocale: 'en-US',
    generalLocale: 'en',
    defaultCurrencyCode: 'USD',
    additionalCurrencyCodes: [],
    defaultTimezone: 'America/New_York',
    firstDayOfWeek: 0,
    dateFormatShort: 'MM/dd/yyyy',
    dateFormatLong: 'MMMM d, yyyy',
    taxIdTypesHint: ['SSN', 'EIN'],
    uiLocaleReady: true,
  },
];

const mockCurrencies = [
  { code: 'COP', nameEn: 'Colombian Peso', nameEs: 'Peso colombiano', symbol: '$', decimals: 2, displayDecimals: 0 },
  { code: 'USD', nameEn: 'US Dollar', nameEs: 'Dólar estadounidense', symbol: '$', decimals: 2, displayDecimals: 2 },
];

type MockCurrentLocale = {
  locale: string;
  language: string;
  countryCode: string;
  currency: string;
  currencySymbol: string;
  legalDecimals: number;
  displayDecimals: number;
  timezone: string;
  firstDayOfWeek: number;
  dateFormatShort: string;
  localeOverride: string | null;
  currencyOverride: string | null;
  timezoneOverride: string | null;
  firstDayOfWeekOverride: number | null;
  uiLocaleReady: boolean;
  isFallback: boolean;
};

const defaultCurrentLocale: MockCurrentLocale = {
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

let mockCurrentLocale = defaultCurrentLocale;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      tenantLocale: {
        get: { invalidate },
      },
    }),
    tenantLocale: {
      get: {
        useQuery: () => ({
          data: mockCurrentLocale,
          isLoading: false,
          error: null,
        }),
      },
      listCountries: {
        useQuery: () => ({ data: mockCountries, isLoading: false, error: null }),
      },
      listCurrencies: {
        useQuery: () => ({ data: mockCurrencies, isLoading: false, error: null }),
      },
      update: {
        useMutation: (options: { onSuccess?: unknown; onError?: unknown }) => ({
          mutate: (...args: unknown[]) => mutate(options, ...args),
          isPending: false,
        }),
      },
    },
  },
}));

import { CompanyLocaleSettingsCard } from './CompanyLocaleSettingsCard';

describe('CompanyLocaleSettingsCard (ENG-017)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCurrentLocale = defaultCurrentLocale;
    await i18n.changeLanguage('en');
  });

  it('renders the card, seeds the picker from the current tenant locale, and shows a live preview', async () => {
    render(<CompanyLocaleSettingsCard />);

    expect(screen.getByTestId('company-locale-card')).toBeInTheDocument();

    // Country picker is pre-filled with the tenant's current country (CO).
    const select = screen.getByTestId('locale-country-select') as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('CO');
    });

    // Preview renders with Colombia defaults — COP 0 decimals (so the
    // sample amount 123,456.789 rounds up to 123,457) and Bogota-local
    // date in dd/MM/yyyy flavor. We just assert "$" is present so the
    // test stays resilient to day-of-month.
    const preview = screen.getByTestId('locale-preview-amount');
    expect(preview.textContent).toContain('$');
    expect(preview.textContent).not.toContain('.79');
    expect(preview.textContent).not.toContain('.78');
  });

  it('updates the live preview when the operator changes the country without firing a server request', async () => {
    render(<CompanyLocaleSettingsCard />);

    const select = screen.getByTestId('locale-country-select');
    fireEvent.change(select, { target: { value: 'US' } });

    await waitFor(() => {
      const amount = screen.getByTestId('locale-preview-amount');
      // USD formatter keeps 2 decimals → value ends with .79 (123456.789 → 123,456.79).
      expect(amount.textContent).toContain('.79');
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('calls the update mutation with the selected country when Save is clicked', () => {
    render(<CompanyLocaleSettingsCard />);

    fireEvent.click(screen.getByTestId('locale-save'));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [, payload] = mutate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload.countryCode).toBe('CO');
    expect(payload.currencyOverride).toBeNull();
    expect(payload.localeOverride).toBeNull();
  });

  it('preserves existing override fields when Save is clicked without edits', () => {
    mockCurrentLocale = {
      ...defaultCurrentLocale,
      locale: 'en-US',
      language: 'en',
      currency: 'USD',
      displayDecimals: 2,
      timezone: 'America/Los_Angeles',
      firstDayOfWeek: 0,
      localeOverride: 'en-US',
      currencyOverride: 'USD',
      timezoneOverride: 'America/Los_Angeles',
      firstDayOfWeekOverride: 0,
    };

    render(<CompanyLocaleSettingsCard />);
    fireEvent.click(screen.getByTestId('locale-save'));

    const [, payload] = mutate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(payload).toMatchObject({
      countryCode: 'CO',
      localeOverride: 'en-US',
      currencyOverride: 'USD',
      timezoneOverride: 'America/Los_Angeles',
      firstDayOfWeekOverride: 0,
    });
  });
});
