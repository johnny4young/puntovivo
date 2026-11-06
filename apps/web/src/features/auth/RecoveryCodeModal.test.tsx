import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';

const mocks = vi.hoisted(() => ({
  status: { data: { configured: false, createdAt: null as string | null } },
  mutateAsync: vi.fn(),
  invalidate: vi.fn(),
  error: null as unknown,
}));

vi.mock('./AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'owner@example.com' } }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ auth: { recoveryCodeStatus: { invalidate: mocks.invalidate } } }),
    auth: {
      recoveryCodeStatus: { useQuery: () => mocks.status },
      generateRecoveryCode: {
        useMutation: () => ({
          mutateAsync: mocks.mutateAsync,
          isPending: false,
          error: mocks.error,
        }),
      },
    },
  },
}));

import { RecoveryCodeModal } from './RecoveryCodeModal';

beforeEach(async () => {
  await i18n.changeLanguage('es');
  mocks.status = { data: { configured: false, createdAt: null } };
  mocks.error = null;
  mocks.mutateAsync.mockReset().mockResolvedValue({ code: 'AB12C-DE34F-GH56J-KM78N' });
});

describe('RecoveryCodeModal', () => {
  it('asks for the current password and shows the new code once', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<RecoveryCodeModal onClose={vi.fn()} prompt />);

    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Contraseña actual'), {
      target: { value: 'OldOwnerPassword42!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generar código' }));

    expect(await screen.findByTestId('recovery-code-value')).toHaveTextContent(
      'AB12C-DE34F-GH56J-KM78N'
    );
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ currentPassword: 'OldOwnerPassword42!' });
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('AB12C-DE34F-GH56J-KM78N'));
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('warns that regenerating replaces an existing code', () => {
    mocks.status = { data: { configured: true, createdAt: '2026-11-01T12:00:00.000Z' } };
    render(<RecoveryCodeModal onClose={vi.fn()} />);
    expect(screen.getByText(/Generar uno nuevo invalida el anterior/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('requires the current password before generating', async () => {
    render(<RecoveryCodeModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generar código' }));
    expect(await screen.findByText('La contraseña actual es obligatoria')).toBeInTheDocument();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
