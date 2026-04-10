import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import { ChangePasswordModal } from '../ChangePasswordModal';

const { mutateAsyncMock, logoutMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  mutateAsyncMock: vi.fn(),
  logoutMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      changePassword: {
        useMutation: () => ({
          mutateAsync: mutateAsyncMock,
          isPending: false,
          error: null,
        }),
      },
    },
  },
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
  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsyncMock.mockResolvedValue({
      success: true,
      message: 'Password changed successfully',
    });
    logoutMock.mockResolvedValue(undefined);
  });

  it('submits the password change and logs the user out on success', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ChangePasswordModal isOpen onClose={onClose} />);

    await user.type(screen.getByLabelText(/current password/i), 'CurrentPassword123!');
    await user.type(screen.getByLabelText(/^new password$/i), 'NewPassword123!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewPassword123!');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        currentPassword: 'CurrentPassword123!',
        newPassword: 'NewPassword123!',
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: 'Password changed',
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
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(logoutMock).not.toHaveBeenCalled();
  });
});
