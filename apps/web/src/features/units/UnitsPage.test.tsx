import { screen } from '@testing-library/react';
import i18next from 'i18next';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: useAuthMock }));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const conflict = {
  data: {
    errorCode: 'UNIT_ABBREVIATION_CONFLICT',
    errorDetails: { abbreviation: 'UND' },
  },
  message: 'A unit with this abbreviation already exists',
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ units: { list: { invalidate: vi.fn() } } }),
    units: {
      list: {
        useQuery: () => ({
          data: { items: [] },
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      create: {
        useMutation: () => ({
          mutateAsync: vi.fn(),
          isPending: false,
          error: conflict,
          reset: vi.fn(),
        }),
      },
      update: {
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

import { UnitsPage } from './UnitsPage';

beforeAll(async () => {
  useAuthMock.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
  await i18next.changeLanguage('es');
});

afterAll(async () => {
  await i18next.changeLanguage('en');
});

describe('UnitsPage mutation errors', () => {
  it('renders the localized unit conflict instead of the internal tRPC message', async () => {
    const user = userEvent.setup();
    render(<UnitsPage />);

    await user.click(screen.getByRole('button', { name: 'Agregar unidad' }));

    expect(
      await screen.findByText(
        'Ya existe una unidad con la abreviatura UND. Edita la unidad existente.'
      )
    ).toBeVisible();
    expect(
      screen.queryByText('A unit with this abbreviation already exists')
    ).not.toBeInTheDocument();
  });
});
