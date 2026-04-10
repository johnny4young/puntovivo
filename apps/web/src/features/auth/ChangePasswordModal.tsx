import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';
import { useAuth } from './AuthProvider';
import { getPasswordRequirementMessage } from './passwordPolicy';

interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const defaultValues: ChangePasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const { logout } = useAuth();
  const toast = useToast();
  const form = useForm<ChangePasswordFormValues>({
    defaultValues,
  });
  const changePasswordMutation = trpc.auth.changePassword.useMutation();

  const handleClose = () => {
    form.reset(defaultValues);
    onClose();
  };

  const handleSubmit = form.handleSubmit(async values => {
    await changePasswordMutation.mutateAsync({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });

    handleClose();
    toast.success({
      title: 'Password changed',
      description: 'Please sign in again with your new password.',
    });
    await logout();
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Change Password"
      footer={
        <>
          <ModalButton onClick={handleClose} disabled={changePasswordMutation.isPending}>
            Cancel
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={changePasswordMutation.isPending}
          >
            {changePasswordMutation.isPending ? 'Updating...' : 'Update Password'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-sm text-secondary-600">
          Use a new password with at least 12 characters, plus uppercase, lowercase, number, and
          special character requirements.
        </p>

        <div>
          <label htmlFor="current-password" className="label">
            Current Password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            className="input mt-1"
            {...form.register('currentPassword', {
              required: 'Current password is required',
            })}
          />
          {form.formState.errors.currentPassword && (
            <p className="mt-1 text-sm text-danger-600">
              {form.formState.errors.currentPassword.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-password" className="label">
            New Password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className="input mt-1"
            {...form.register('newPassword', {
              required: 'New password is required',
              validate: value => getPasswordRequirementMessage(value) ?? true,
            })}
          />
          {form.formState.errors.newPassword && (
            <p className="mt-1 text-sm text-danger-600">{form.formState.errors.newPassword.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="confirm-password" className="label">
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            className="input mt-1"
            {...form.register('confirmPassword', {
              required: 'Please confirm your new password',
              validate: value =>
                value === form.getValues('newPassword') || 'Passwords do not match',
            })}
          />
          {form.formState.errors.confirmPassword && (
            <p className="mt-1 text-sm text-danger-600">
              {form.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        {changePasswordMutation.error && (
          <p className="text-sm text-danger-600">
            {getErrorMessage(changePasswordMutation.error, 'Unable to change password')}
          </p>
        )}
      </form>
    </Modal>
  );
}
