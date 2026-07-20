/**
 * Tests de `CompanyClFiscalCard`.
 *
 * Cobertura:
 * - Renderiza la card cuando el tenant es CL con badge rojo y los
 * issues que el adapter reporta.
 * - Renderiza nada cuando el tenant es CO (defensive layer; el
 * dispatch real vive en CompanyPage).
 * - Submit del form llama a `fiscalSettings.updateCl` con el shape
 * correcto.
 * - Cuando la config fiscal está sin configurar (pack apagado + todos
 * los campos vacíos) muestra un EmptyState con CTA Configurar que
 * revela el form; con config existente el form se renderiza directo.
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

let mockCountryCode: 'MX' | 'CO' | 'CL' = 'CL';
type ClSettingsResponse = {
  countryCode: 'CL';
  settings: {
    enabled: boolean;
    rut: string | null;
    giroCode: string | null;
    comunaCode: number | null;
    casaMatriz: string | null;
    environment: 'certificacion' | 'produccion';
  };
  validation: {
    ok: boolean;
    issues: Array<{ code: string; field: string; message: string }>;
  };
  maturity: 'mock' | 'draft' | 'certified';
};

// Caso por defecto: tenant CL sin configurar (pack apagado, campos
// vacíos). En este estado la card muestra el EmptyState con el CTA
// Configurar; los tests del form revelan el form primero. Los tests
// que necesitan el form directo sobreescriben `mockSettingsResponse`.
const UNCONFIGURED_CL: ClSettingsResponse = {
  countryCode: 'CL',
  settings: {
    enabled: false,
    rut: null,
    giroCode: null,
    comunaCode: null,
    casaMatriz: null,
    environment: 'certificacion',
  },
  validation: {
    ok: false,
    issues: [
      { code: 'MISSING_RUT', field: 'fiscal.cl.rut', message: 'falta rut' },
      {
        code: 'MISSING_RESOLUTION',
        field: 'fiscal.cl.giroCode',
        message: 'falta giro',
      },
      {
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.cl.casaMatriz',
        message: 'falta casa matriz',
      },
      {
        code: 'MISSING_CERTIFICATE',
        field: 'fiscal.cl.comunaCode',
        message: 'falta comuna',
      },
    ],
  },
  maturity: 'draft',
};

let mockSettingsResponse: ClSettingsResponse = UNCONFIGURED_CL;

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
      // read-only CAF lookup. Default to "no active CAF" so
      // the existing tests render the empty branch; tests that need a
      // populated CAF override `mockCafResponse` before render.
      getActiveCaf: {
        useQuery: () => ({
          data: { caf: null },
          isLoading: false,
          error: null,
        }),
      },
      updateCl: {
        useMutation: (options: { onSuccess?: unknown; onError?: unknown }) => ({
          mutate: (...args: unknown[]) => updateMutate(options, ...args),
          mutateAsync: async (...args: unknown[]) => updateMutate(options, ...args),
          isPending: false,
        }),
      },
    },
  },
}));

import { CompanyClFiscalCard } from './CompanyClFiscalCard';

describe('CompanyClFiscalCard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockCountryCode = 'CL';
    mockSettingsResponse = UNCONFIGURED_CL;
    await i18n.changeLanguage('en');
  });

  it('muestra el EmptyState (sin form) cuando la config está sin configurar', () => {
    render(<CompanyClFiscalCard />);
    // El header + el badge de readiness siguen visibles.
    expect(screen.getByText(/Chile — SII/i)).toBeInTheDocument();
    expect(screen.getByTestId('fiscal-cl-readiness')).toHaveTextContent(/Not ready/i);
    expect(screen.getByTestId('fiscal-maturity-badge')).toHaveTextContent(/Draft/i);
    // EmptyState visible; form oculto hasta el CTA.
    expect(screen.getByTestId('fiscal-cl-empty')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Issuer RUT/i)).not.toBeInTheDocument();
  });

  it('el CTA Configurar revela el form CL con el badge rojo', () => {
    render(<CompanyClFiscalCard />);
    fireEvent.click(screen.getByTestId('fiscal-cl-configure'));
    expect(screen.queryByTestId('fiscal-cl-empty')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Issuer RUT/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /4711/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Santiago/i })).toBeInTheDocument();
  });

  it('con config existente renderiza el form directo (sin EmptyState)', () => {
    mockSettingsResponse = {
      ...UNCONFIGURED_CL,
      settings: {
        enabled: true,
        rut: '76123456-0',
        giroCode: '4711',
        comunaCode: 13101,
        casaMatriz: 'Av Apoquindo 4500',
        environment: 'certificacion',
      },
    };
    render(<CompanyClFiscalCard />);
    expect(screen.queryByTestId('fiscal-cl-empty')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Issuer RUT/i)).toBeInTheDocument();
  });

  it('no renderiza nada cuando el tenant es CO (dispatch del page)', () => {
    mockCountryCode = 'CO';
    const { container } = render(<CompanyClFiscalCard />);
    // El componente devuelve null cuando tenantCountry !== 'CL'.
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza nada cuando el tenant es MX', () => {
    mockCountryCode = 'MX';
    const { container } = render(<CompanyClFiscalCard />);
    expect(container.firstChild).toBeNull();
  });

  it('submit envía el patch con los campos del form', () => {
    render(<CompanyClFiscalCard />);
    fireEvent.click(screen.getByTestId('fiscal-cl-configure'));
    fireEvent.change(screen.getByLabelText(/Issuer RUT/i), {
      target: { value: '55555555-5' },
    });
    fireEvent.change(screen.getByLabelText(/Business activity/i), {
      target: { value: '4711' },
    });
    fireEvent.change(screen.getByLabelText(/Issuance commune/i), {
      target: { value: '13101' },
    });
    fireEvent.change(screen.getByLabelText(/Headquarters address/i), {
      target: { value: 'Av Apoquindo 4500' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save/i }));

    expect(updateMutate).toHaveBeenCalled();
    const lastCall = updateMutate.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({
      rut: '55555555-5',
      giroCode: '4711',
      comunaCode: 13101,
      casaMatriz: 'Av Apoquindo 4500',
      environment: 'certificacion',
    });
  });
});
