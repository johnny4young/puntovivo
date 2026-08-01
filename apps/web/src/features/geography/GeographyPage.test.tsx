import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';

const { useAuthMock, queryMocks } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  queryMocks: {
    countries: vi.fn(),
    departments: vi.fn(),
    cities: vi.fn(),
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const country = {
  id: 'country-co',
  tenantId: 'tenant-1',
  code: 'CO',
  name: 'Colombia',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const department = {
  id: 'department-cun',
  tenantId: 'tenant-1',
  countryId: country.id,
  countryCode: country.code,
  countryName: country.name,
  code: 'CUN',
  name: 'Cundinamarca',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const city = {
  id: 'city-bog',
  tenantId: 'tenant-1',
  departmentId: department.id,
  countryId: country.id,
  countryName: country.name,
  departmentCode: department.code,
  departmentName: department.name,
  code: 'BOG',
  name: 'Bogota',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function queryResult<T>(items: T[]) {
  return {
    data: { items },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
}

function mutationResult() {
  return {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
  };
}

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      countries: { list: { invalidate: vi.fn() } },
      departments: { list: { invalidate: vi.fn() } },
      cities: { list: { invalidate: vi.fn() } },
    }),
    countries: {
      list: {
        useQuery: (input: unknown, options?: unknown) => {
          queryMocks.countries(input, options);
          return queryResult([country]);
        },
      },
      create: { useMutation: mutationResult },
      update: { useMutation: mutationResult },
      delete: { useMutation: mutationResult },
    },
    departments: {
      list: {
        useQuery: (input: unknown, options?: unknown) => {
          queryMocks.departments(input, options);
          return queryResult([department]);
        },
      },
      create: { useMutation: mutationResult },
      update: { useMutation: mutationResult },
      delete: { useMutation: mutationResult },
    },
    cities: {
      list: {
        useQuery: (input: unknown, options?: unknown) => {
          queryMocks.cities(input, options);
          return queryResult([city]);
        },
      },
      create: { useMutation: mutationResult },
      update: { useMutation: mutationResult },
      delete: { useMutation: mutationResult },
    },
  },
}));

import { GeographyPage } from './GeographyPage';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

describe('GeographyPage', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    Object.values(queryMocks).forEach(mock => mock.mockClear());
  });

  it('loads child locations only after their parent context is selected', async () => {
    const user = userEvent.setup();
    render(<GeographyPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Countries, regions, and cities' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Countries/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(await screen.findByRole('button', { name: 'Edit Colombia' })).toBeInTheDocument();
    expect(
      queryMocks.departments.mock.calls.some(([, options]) =>
        expect.objectContaining({ enabled: true }).asymmetricMatch(options)
      )
    ).toBe(false);

    await user.click(screen.getByRole('tab', { name: /Regions or states/ }));
    expect(
      await screen.findByRole('heading', { name: 'Choose a country first' })
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Country'), country.id);

    await waitFor(() =>
      expect(
        queryMocks.departments.mock.calls.some(
          ([input, options]) =>
            expect.objectContaining({ countryId: country.id }).asymmetricMatch(input) &&
            expect.objectContaining({ enabled: true }).asymmetricMatch(options)
        )
      ).toBe(true)
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Regions or states in Colombia' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /View cities/ }));
    expect(screen.getByRole('tab', { name: /Cities/ })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(
        queryMocks.cities.mock.calls.some(
          ([input, options]) =>
            expect.objectContaining({ departmentId: department.id }).asymmetricMatch(input) &&
            expect.objectContaining({ enabled: true }).asymmetricMatch(options)
        )
      ).toBe(true)
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Cities in Cundinamarca' })
    ).toBeInTheDocument();
  });

  it('keeps mutation controls unavailable to non-admin users', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'viewer-1', role: 'viewer' } });
    render(<GeographyPage />);

    expect(await screen.findByRole('button', { name: 'Add country' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an administrator can modify them/)).toBeInTheDocument();
  });
});
