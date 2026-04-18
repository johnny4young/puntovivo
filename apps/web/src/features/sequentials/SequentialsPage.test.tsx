import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
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
          mutateAsync: vi.fn(),
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
      delete: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
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
    await i18next.changeLanguage('en');
  });

  it('renders the quotation document type label for quotation sequentials', () => {
    render(<SequentialsPage />);

    expect(screen.getByText('Quotation')).toBeInTheDocument();
    expect(screen.getByText('COT-')).toBeInTheDocument();
    expect(screen.getByText('Main Site')).toBeInTheDocument();
  });
});
