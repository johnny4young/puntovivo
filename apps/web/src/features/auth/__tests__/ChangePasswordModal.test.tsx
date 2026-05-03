import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { render, screen, waitFor } from '@/test/utils';
import { ChangePasswordModal } from '../ChangePasswordModal';

const { mutateAsyncMock, logoutMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  logoutMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    logout: logoutMock,
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

describe('ChangePasswordModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mutateAsyncMock.mockResolvedValue({
      success: true,
      message: 'Password changed successfully',
    });
    logoutMock.mockResolvedValue(undefined);
    await i18next.changeLanguage('en');
  });

  it('submits the password change and logs the user out on success', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ChangePasswordModal isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText(/current password/i), 'CurrentPassword123!');
    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        currentPassword: 'CurrentPassword123!',
        newPassword: 'NewPassword123!',
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: 'Password changed successfully',
      description: 'Please sign in again with your new password.',
    });
    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks submit when the password confirmation does not match', async () => {
    const user = userEvent.setup();

    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/current password/i), 'CurrentPassword123!');
    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'MismatchPassword123!');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and does not log out when the server rejects the change', async () => {
    mutateAsyncMock.mockRejectedValueOnce(new Error('Current password is incorrect'));
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ChangePasswordModal isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText(/current password/i), 'WrongPassword123!');
    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledOnce();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('uses translated toast copy when the active language is Spanish', async () => {
    await i18next.changeLanguage('es');
    const user = userEvent.setup();

    render(<ChangePasswordModal isOpen onClose={vi.fn()} />);

    const currentPasswordInput = await screen.findByLabelText(/contraseña actual/i);
    const newPasswordInput = await screen.findByLabelText(/^nueva contraseña$/i);
    const confirmPasswordInput = await screen.findByLabelText(/confirmar nueva contraseña/i);

    await user.type(currentPasswordInput, 'CurrentPassword123!');
    await user.type(newPasswordInput, 'NewPassword123!');
    await user.type(confirmPasswordInput, 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith({
        title: 'Contraseña cambiada correctamente',
        description: 'Por favor inicia sesión nuevamente con tu nueva contraseña.',
      });
    });
  });
});
