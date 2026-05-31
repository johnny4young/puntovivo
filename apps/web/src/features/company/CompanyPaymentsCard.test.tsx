/**
 * ENG-038 slice 2 — Tests for CompanyPaymentsCard.
 *
 * Coverage:
 * - Renders one section per manifest rail with stub badge + missing-fields readiness.
 * - Sensitive credential inputs render as password type with a reveal toggle.
 * - Save submission forwards every declared credential field for the rail.
 * - Loading state renders before the query resolves.
 * - Server error fallback renders when the query errors out.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const baseRailResponse = {
  rails: [
    {
      railId: 'wompi' as const,
      label: 'Wompi',
      countryFocus: ['CO'],
      liveIntegration: false,
      credentials: [
        {
          key: 'publicKey',
          value: '',
          hasStoredValue: false,
          sensitive: true,
        },
        {
          key: 'privateKey',
          value: '',
          hasStoredValue: false,
          sensitive: true,
        },
      ],
      validation: {
        ok: false,
        issues: [
          {
            code: 'PAYMENT_CREDENTIAL_MISSING',
            message: 'missing publicKey',
            field: 'publicKey',
          },
          {
            code: 'PAYMENT_CREDENTIAL_MISSING',
            message: 'missing privateKey',
            field: 'privateKey',
          },
        ],
      },
    },
    {
      railId: 'mercado_pago' as const,
      label: 'Mercado Pago',
      countryFocus: ['AR', 'BR', 'CL', 'CO', 'MX', 'PE', 'UY'],
      liveIntegration: false,
      credentials: [
        {
          key: 'accessToken',
          value: '••••••••XYZ',
          hasStoredValue: true,
          sensitive: true,
        },
      ],
      validation: { ok: true, issues: [] },
    },
  ],
};

let mockQueryState: {
  data: typeof baseRailResponse | undefined;
  isLoading: boolean;
  error: Error | null;
} = {
  data: baseRailResponse,
  isLoading: false,
  error: null,
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      paymentSettings: {
        getAll: { invalidate },
      },
    }),
    paymentSettings: {
      getAll: {
        useQuery: () => mockQueryState,
      },
      updateRail: {
        useMutation: (options: { onSuccess?: unknown; onError?: unknown }) => ({
          mutate: (...args: unknown[]) => updateMutate(options, ...args),
          mutateAsync: async (...args: unknown[]) =>
            updateMutate(options, ...args),
          isPending: false,
          variables: undefined,
        }),
      },
    },
  },
}));

import { CompanyPaymentsCard } from './CompanyPaymentsCard';

describe('CompanyPaymentsCard (ENG-038 slice 2)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQueryState = {
      data: baseRailResponse,
      isLoading: false,
      error: null,
    };
    await i18n.changeLanguage('en');
  });

  it('renders one section per manifest rail with a missing-credentials readiness chip for the unconfigured rail', () => {
    render(<CompanyPaymentsCard />);
    expect(screen.getByTestId('payments-rail-wompi')).toBeInTheDocument();
    expect(screen.getByTestId('payments-rail-mercado_pago')).toBeInTheDocument();
    expect(screen.getByTestId('payments-rail-wompi-readiness')).toHaveTextContent(
      /Missing credentials/i
    );
    expect(
      screen.getByTestId('payments-rail-mercado_pago-readiness')
    ).toHaveTextContent(/Ready/i);
  });

  it('renders sensitive fields as password inputs with a reveal toggle', () => {
    render(<CompanyPaymentsCard />);
    const input = screen.getByTestId(
      'payments-wompi-publicKey-input'
    ) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByTestId('payments-wompi-publicKey-reveal'));
    expect(input.type).toBe('text');
  });

  it('forwards every declared credential field for the rail on save', async () => {
    render(<CompanyPaymentsCard />);
    const publicKeyInput = screen.getByTestId(
      'payments-wompi-publicKey-input'
    ) as HTMLInputElement;
    fireEvent.change(publicKeyInput, {
      target: { value: 'pub_test_aaa111' },
    });
    fireEvent.change(screen.getByTestId('payments-wompi-privateKey-input'), {
      target: { value: 'prv_test_bbb222' },
    });
    fireEvent.click(screen.getByTestId('payments-rail-wompi-save'));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const args = updateMutate.mock.calls[0]?.[1];
    expect(args).toMatchObject({
      railId: 'wompi',
      credentials: {
        publicKey: 'pub_test_aaa111',
        privateKey: 'prv_test_bbb222',
      },
    });
    await waitFor(() => expect(publicKeyInput.value).toBe(''));
  });

  it('does not resubmit masked stored credentials when an unchanged rail is saved', async () => {
    render(<CompanyPaymentsCard />);
    expect(
      screen.getByTestId('payments-mercado_pago-accessToken-hint')
    ).toHaveTextContent('••••••••XYZ');
    fireEvent.click(screen.getByTestId('payments-rail-mercado_pago-save'));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const args = updateMutate.mock.calls[0]?.[1];
    expect(args).toMatchObject({
      railId: 'mercado_pago',
      credentials: {},
    });
  });

  it('submits an explicit empty value when the operator clears a stored credential', async () => {
    render(<CompanyPaymentsCard />);
    fireEvent.click(
      screen.getByTestId('payments-mercado_pago-accessToken-clear')
    );
    fireEvent.click(screen.getByTestId('payments-rail-mercado_pago-save'));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const args = updateMutate.mock.calls[0]?.[1];
    expect(args).toMatchObject({
      railId: 'mercado_pago',
      credentials: {
        accessToken: '',
      },
    });
  });

  it('renders the loading state while the query is pending', () => {
    mockQueryState = { data: undefined, isLoading: true, error: null };
    render(<CompanyPaymentsCard />);
    expect(screen.getByTestId('payments-card-loading')).toBeInTheDocument();
  });

  it('renders the error fallback when the query fails', () => {
    mockQueryState = {
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    };
    render(<CompanyPaymentsCard />);
    expect(screen.getByTestId('payments-card-error')).toBeInTheDocument();
  });
});
