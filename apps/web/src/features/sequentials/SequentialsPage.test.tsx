import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import type { Sequential, Site } from '@/types';
import { SequentialsPage } from './SequentialsPage';

const sites: Site[] = [
  {
    id: 'site-1',
    tenantId: 'tenant-1',
    companyId: 'company-1',
    name: 'Main Site',
    address: null,
    phone: null,
    isActive: true,
    createdAt: new Date('2026-04-17T12:00:00Z').toISOString(),
    updatedAt: new Date('2026-04-17T12:00:00Z').toISOString(),
  },
];

const sequentials: Sequential[] = [
  {
    id: 'seq-quotation',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    siteName: 'Main Site',
    documentType: 'quotation',
    prefix: 'COT-',
    currentValue: 7,
    createdAt: new Date('2026-04-17T12:00:00Z').toISOString(),
    updatedAt: new Date('2026-04-17T12:00:00Z').toISOString(),
  },
];

let upsertError: unknown = null;
const upsertMutateAsync = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      tenantId: 'tenant-1',
      role: 'admin',
    },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      setupReadiness: {
        get: { invalidate: vi.fn(async () => undefined) },
        checkout: { invalidate: vi.fn(async () => undefined) },
      },
      sequentials: {
        list: { invalidate: vi.fn(async () => undefined) },
      },
    }),
    sites: {
      list: {
        useQuery: () => ({
          data: { items: sites },
          isLoading: false,
          error: null,
        }),
      },
    },
    sequentials: {
      list: {
        useQuery: () => ({
          data: { items: sequentials },
          isLoading: false,
          error: null,
        }),
      },
      upsert: {
        useMutation: () => ({
          mutateAsync: upsertMutateAsync,
          isPending: false,
          error: upsertError,
          reset: vi.fn(),
        }),
      },
      delete: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

describe('SequentialsPage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    upsertError = null;
    await i18next.changeLanguage('en');
  });

  it('renders the quotation document type label for quotation sequentials', () => {
    render(<SequentialsPage />);

    expect(screen.getByText('Quotation')).toBeInTheDocument();
    expect(screen.getByText('COT-')).toBeInTheDocument();
    expect(screen.getByText('Main Site')).toBeInTheDocument();
    expect(screen.getByText('COT-000008')).toBeInTheDocument();
    expect(screen.getByText(/Puntovivo advances these counters automatically/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('shows the translated rewind rejection inside the form', async () => {
    upsertError = {
      message: 'The last used number cannot be lower than 4, already issued',
      data: {
        code: 'BAD_REQUEST',
        errorCode: 'SEQUENTIAL_BELOW_ISSUED',
        errorDetails: { highestIssued: 4 },
      },
    };
    await i18next.changeLanguage('es');
    render(<SequentialsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(
      await screen.findByText(
        'El último número usado no puede ser menor que 4, que ya fue emitido.'
      )
    ).toBeInTheDocument();
  });

  it('catches a rejected upsert mutation without leaking an unhandled rejection', async () => {
    upsertMutateAsync.mockRejectedValueOnce(new Error('SEQUENTIAL_BELOW_ISSUED'));
    render(<SequentialsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: /Save|Update/i }));

    expect(upsertMutateAsync).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
