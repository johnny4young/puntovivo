import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { useAuth } from './AuthProvider';
import { getPasswordRequirementMessage, type PasswordRequirementKey } from './passwordPolicy';

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
  const { t } = useTranslation(['auth', 'common', 'errors']);
  const toast = useToast();
  const form = useForm<ChangePasswordFormValues>({
    defaultValues,
  });
  const changePasswordMutation = useCriticalMutation('auth.changePassword');
  const translatePasswordRequirement = (key: PasswordRequirementKey) =>
    t(`common:passwordPolicy.${key}`);

  const handleClose = () => {
    form.reset(defaultValues);
    onClose();
  };

  const handleSubmit = form.handleSubmit(async values => {
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
    } catch {
      return;
    }

    handleClose();
    toast.success({
      title: t('changePassword.success'),
      description: t('changePassword.successDescription'),
    });
    await logout();
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('changePassword.title')}
      footer={
        <>
          <ModalButton onClick={handleClose} disabled={changePasswordMutation.isPending}>
            {t('changePassword.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleSubmit}
            disabled={changePasswordMutation.isPending}
          >
            {changePasswordMutation.isPending
              ? t('changePassword.updating')
              : t('changePassword.submit')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-sm text-secondary-600">
          {t('changePassword.requirements')}
        </p>

        <div>
          <label htmlFor="current-password" className="label">
            {t('changePassword.currentPassword')}
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            className="input mt-1"
            {...form.register('currentPassword', {
              required: t('changePassword.currentRequired'),
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
            {t('changePassword.newPassword')}
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className="input mt-1"
            {...form.register('newPassword', {
              required: t('changePassword.newRequired'),
              validate: value => getPasswordRequirementMessage(value, translatePasswordRequirement) ?? true,
            })}
          />
          {form.formState.errors.newPassword && (
            <p className="mt-1 text-sm text-danger-600">{form.formState.errors.newPassword.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="confirm-password" className="label">
            {t('changePassword.confirmPassword')}
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            className="input mt-1"
            {...form.register('confirmPassword', {
              required: t('changePassword.confirmRequired'),
              validate: value =>
                value === form.getValues('newPassword') || t('changePassword.passwordMismatch'),
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
            {translateServerError(
              changePasswordMutation.error,
              t,
              t('auth:changePassword.updateError')
            )}
          </p>
        )}
      </form>
    </Modal>
  );
}
