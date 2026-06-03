/**
 * ENG-184 — Tests for `CompanyCoFiscalCard`.
 *
 * Coverage:
 * - Renders the card when the tenant is CO with a red readiness badge
 *   and the presence issues the server reports.
 * - Renders nothing when the tenant is MX/CL (defensive layer; the
 *   CompanyPage dispatches by country).
 * - The "Set up DIAN" CTA reveals the form from the optional EmptyState.
 * - Submitting the form calls `fiscalSettings.updateCo` with the right
 *   shape (numbers parsed for the range bounds).
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const updateMutate = vi.fn();
const invalidateFiscalSettings = vi.fn(async () => undefined);
const invalidateSetupReadiness = vi.fn(async () => undefined);
const invalidateCheckoutReadiness = vi.fn(async () => undefined);

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

let mockCountryCode: 'MX' | 'CO' | 'CL' = 'CO';
type CoSettingsResponse = {
  countryCode: 'MX' | 'CO' | 'CL';
  settings: {
    enabled: boolean;
    nit: string | null;
    dianResolutionNumber: string | null;
    prefix: string | null;
    rangeFrom: number | null;
    rangeTo: number | null;
    environment: 'habilitacion' | 'produccion';
  } | null;
  validation: {
    ok: boolean;
    issues: Array<{ code: string; field: string; message: string }>;
  };
  maturity: 'mock' | 'draft' | 'certified';
};

const UNCONFIGURED_CO: CoSettingsResponse = {
  countryCode: 'CO',
  settings: {
    enabled: false,
    nit: null,
    dianResolutionNumber: null,
    prefix: null,
    rangeFrom: null,
    rangeTo: null,
    environment: 'habilitacion',
  },
  validation: {
    ok: false,
    issues: [
      { code: 'MISSING_NIT', field: 'fiscal.co.nit', message: 'falta nit' },
      {
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.co.dianResolutionNumber',
        message: 'falta resolución',
      },
      {
        code: 'MISSING_RANGE',
        field: 'fiscal.co.rangeFrom',
        message: 'falta rango',
      },
    ],
  },
  maturity: 'mock',
};

let mockSettingsResponse: CoSettingsResponse = UNCONFIGURED_CO;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      fiscalSettings: {
        getByCountry: { invalidate: invalidateFiscalSettings },
      },
      setupReadiness: {
        get: { invalidate: invalidateSetupReadiness },
        checkout: { invalidate: invalidateCheckoutReadiness },
      },
    }),
    tenantLocale: {
      get: {
        useQuery: () => ({
          data: { countryCode: mockCountryCode },
          isLoading: false,
          error: null,
        }),
      },
    },
    fiscalSettings: {
      getByCountry: {
        useQuery: () => ({
          data: mockSettingsResponse,
          isLoading: false,
          error: null,
        }),
      },
      updateCo: {
        useMutation: (options: { onSuccess?: unknown; onError?: unknown }) => ({
          mutate: (...args: unknown[]) => updateMutate(options, ...args),
          mutateAsync: async (...args: unknown[]) =>
            updateMutate(options, ...args),
          isPending: false,
        }),
      },
    },
  },
}));

import { CompanyCoFiscalCard } from './CompanyCoFiscalCard';

describe('CompanyCoFiscalCard (ENG-184)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCountryCode = 'CO';
    mockSettingsResponse = UNCONFIGURED_CO;
    await i18n.changeLanguage('en');
  });

  it('shows the optional EmptyState (no form) when DIAN is unconfigured', () => {
    render(<CompanyCoFiscalCard />);
    expect(screen.getByText(/Colombia — DIAN/i)).toBeInTheDocument();
    expect(screen.getByTestId('fiscal-co-readiness')).toHaveTextContent(
      /Not ready/i
    );
    expect(screen.getByTestId('fiscal-maturity-badge')).toHaveTextContent(
      /Demo/i
    );
    expect(screen.getByTestId('fiscal-co-empty')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Issuer NIT/i)).not.toBeInTheDocument();
  });

  it('the Set up CTA reveals the DIAN form with the red badge', () => {
    render(<CompanyCoFiscalCard />);
    fireEvent.click(screen.getByTestId('fiscal-co-configure'));
    expect(screen.queryByTestId('fiscal-co-empty')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Issuer NIT/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/DIAN numbering resolution/i)
    ).toBeInTheDocument();
  });

  it('renders the form directly when config already exists', () => {
    mockSettingsResponse = {
      ...UNCONFIGURED_CO,
      settings: {
        enabled: true,
        nit: '900123456-7',
        dianResolutionNumber: '18760000001',
        prefix: 'SETP',
        rangeFrom: 1,
        rangeTo: 5000,
        environment: 'produccion',
      },
    };
    render(<CompanyCoFiscalCard />);
    expect(screen.queryByTestId('fiscal-co-empty')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Issuer NIT/i)).toBeInTheDocument();
  });

  it('renders nothing when the tenant is MX (CompanyPage dispatches)', () => {
    mockCountryCode = 'MX';
    const { container } = render(<CompanyCoFiscalCard />);
    expect(container.firstChild).toBeNull();
  });

  it('submit sends the patch with NIT, resolution and parsed numeric range', () => {
    render(<CompanyCoFiscalCard />);
    fireEvent.click(screen.getByTestId('fiscal-co-configure'));
    fireEvent.change(screen.getByLabelText(/Issuer NIT/i), {
      target: { value: '900123456-7' },
    });
    fireEvent.change(screen.getByLabelText(/DIAN numbering resolution/i), {
      target: { value: '18760000001' },
    });
    fireEvent.change(screen.getByLabelText(/Range from/i), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByLabelText(/Range to/i), {
      target: { value: '5000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    expect(updateMutate).toHaveBeenCalled();
    const lastCall = updateMutate.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({
      nit: '900123456-7',
      dianResolutionNumber: '18760000001',
      rangeFrom: 1,
      rangeTo: 5000,
      environment: 'habilitacion',
    });
  });
});
