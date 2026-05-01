/**
 * ENG-035a — Tests de `CompanyMxFiscalCard`.
 *
 * Cobertura:
 * - Renderiza la card cuando el tenant es MX con badge rojo y los
 *   issues que el adapter reporta.
 * - No renderiza nada cuando el tenant es CO o CL (defensive layer;
 *   ENG-036a movió el dispatch al CompanyPage para que cada país
 *   monte su propia card sin que MX tenga que conocer al resto).
 * - Submit del form llama a `fiscalSettings.updateMx` con el shape
 *   correcto.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const updateMutate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

let mockCountryCode: 'MX' | 'CO' | 'CL' = 'MX';
const mockSettingsResponse: {
  countryCode: 'MX' | 'CO' | 'CL';
  settings: {
    enabled: boolean;
    rfc: string | null;
    regimenFiscalCode: string | null;
    lugarExpedicion: string | null;
    environment: 'sandbox' | 'production';
  } | null;
  validation: {
    ok: boolean;
    issues: Array<{ code: string; field: string; message: string }>;
  };
} = {
  countryCode: 'MX',
  settings: {
    enabled: false,
    rfc: null,
    regimenFiscalCode: null,
    lugarExpedicion: null,
    environment: 'sandbox',
  },
  validation: {
    ok: false,
    issues: [
      { code: 'MISSING_RFC', field: 'fiscal.mx.rfc', message: 'falta rfc' },
      {
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.mx.regimenFiscalCode',
        message: 'falta régimen',
      },
      {
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.mx.lugarExpedicion',
        message: 'falta lugar',
      },
    ],
  },
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      fiscalSettings: {
        getByCountry: { invalidate },
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
      updateMx: {
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

import { CompanyMxFiscalCard } from './CompanyMxFiscalCard';

describe('CompanyMxFiscalCard (ENG-035a)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCountryCode = 'MX';
    await i18n.changeLanguage('en');
  });

  it('renderiza el form MX con el badge rojo cuando readiness.ok=false', () => {
    render(<CompanyMxFiscalCard />);
    expect(screen.getByText(/Mexico — CFDI 4.0/i)).toBeInTheDocument();
    expect(screen.getByTestId('fiscal-mx-readiness')).toHaveTextContent(
      /Not ready/i
    );
    expect(screen.getByLabelText(/Issuer RFC/i)).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /609 — Consolidación/i })
    ).toBeInTheDocument();
  });

  it('no renderiza nada cuando el tenant es CO (CompanyPage hace el dispatch)', () => {
    mockCountryCode = 'CO';
    const { container } = render(<CompanyMxFiscalCard />);
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza nada cuando el tenant es CL (CompanyPage hace el dispatch)', () => {
    mockCountryCode = 'CL';
    const { container } = render(<CompanyMxFiscalCard />);
    expect(container.firstChild).toBeNull();
  });

  it('submit envía el patch con los campos del form', () => {
    render(<CompanyMxFiscalCard />);
    fireEvent.change(screen.getByLabelText(/Issuer RFC/i), {
      target: { value: 'XEXX010101000' },
    });
    fireEvent.change(screen.getByLabelText(/Fiscal regime/i), {
      target: { value: '601' },
    });
    fireEvent.change(screen.getByLabelText(/Place of issuance/i), {
      target: { value: '06700' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    expect(updateMutate).toHaveBeenCalled();
    const lastCall = updateMutate.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
      lugarExpedicion: '06700',
      environment: 'sandbox',
    });
  });
});
