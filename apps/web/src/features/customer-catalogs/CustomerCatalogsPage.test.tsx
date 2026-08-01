import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';

const { useAuthMock, queryMocks } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  queryMocks: {
    identificationTypes: vi.fn(),
    personTypes: vi.fn(),
    regimeTypes: vi.fn(),
    clientTypes: vi.fn(),
    commercialActivities: vi.fn(),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const item = {
  id: 'catalog-1',
  tenantId: 'tenant-1',
  code: 'CC',
  name: 'Cédula de ciudadanía',
  description: null,
  isActive: true,
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
};

function mutationResult() {
  return {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
  };
}

function queryResult() {
  return {
    data: { items: [item] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function catalogRouter(key: keyof typeof queryMocks) {
  return {
    list: {
      useQuery: (input: unknown, options: unknown) => {
        queryMocks[key](input, options);
        return queryResult();
      },
    },
    create: { useMutation: mutationResult },
    update: { useMutation: mutationResult },
    delete: { useMutation: mutationResult },
  };
}

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      identificationTypes: { list: { invalidate: vi.fn() } },
      personTypes: { list: { invalidate: vi.fn() } },
      regimeTypes: { list: { invalidate: vi.fn() } },
      clientTypes: { list: { invalidate: vi.fn() } },
      commercialActivities: { list: { invalidate: vi.fn() } },
    }),
    identificationTypes: catalogRouter('identificationTypes'),
    personTypes: catalogRouter('personTypes'),
    regimeTypes: catalogRouter('regimeTypes'),
    clientTypes: catalogRouter('clientTypes'),
    commercialActivities: catalogRouter('commercialActivities'),
  },
}));

import { CustomerCatalogsPage } from './CustomerCatalogsPage';

describe('CustomerCatalogsPage', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    useAuthMock.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    Object.values(queryMocks).forEach(mock => mock.mockClear());
  });

  it('enables only the selected catalog query and explains its purpose', async () => {
    const user = userEvent.setup();
    render(<CustomerCatalogsPage />);

    expect(screen.getByRole('heading', { name: 'Fiscal and commercial data' })).toBeInTheDocument();
    expect(
      screen.getByText(/Use the exact code required on the electronic invoice/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Identification types' })
    ).toBeInTheDocument();
    expect(queryMocks.identificationTypes).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: true })
    );
    expect(queryMocks.personTypes).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );

    await user.click(screen.getByRole('tab', { name: 'Commercial activity' }));
    expect(screen.getByRole('tab', { name: 'Commercial activity' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText(/Use the current official code that applies/)).toBeInTheDocument();
    expect(queryMocks.commercialActivities).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: true })
    );
    expect(queryMocks.identificationTypes).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ enabled: false })
    );
  });

  it('gives admin row actions localized accessible names', () => {
    render(<CustomerCatalogsPage />);

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByText('No note')).toBeInTheDocument();
    expect(screen.getByText('Citizenship ID')).toBeInTheDocument();
    expect(screen.queryByText('Cédula de ciudadanía')).not.toBeInTheDocument();
  });

  it('filters by the localized name the operator can see', async () => {
    const user = userEvent.setup();
    render(<CustomerCatalogsPage />);

    await user.type(screen.getByPlaceholderText('Search by name or code...'), 'Citizenship');

    expect(screen.getByText('Citizenship ID')).toBeInTheDocument();
    expect(screen.getByText('CC')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search by name or code...'));
    await user.type(screen.getByPlaceholderText('Search by name or code...'), 'CC');
    expect(screen.getByText('Citizenship ID')).toBeInTheDocument();
  });

  it('keeps the persisted catalog name raw when editing a localized row', async () => {
    const user = userEvent.setup();
    const controller = createNavigationGuardController();
    render(
      <NavigationGuardProvider controller={controller}>
        <CustomerCatalogsPage />
      </NavigationGuardProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByLabelText('Visible name')).toHaveValue('Cédula de ciudadanía');
  });

  it('keeps catalog changes unavailable to non-admin users', () => {
    useAuthMock.mockReturnValue({ user: { id: 'manager-1', role: 'manager' } });
    render(<CustomerCatalogsPage />);

    expect(screen.getByRole('button', { name: 'Add identification type' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an administrator can modify them/)).toBeInTheDocument();
  });
});
