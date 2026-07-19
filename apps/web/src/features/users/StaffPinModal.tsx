import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';

export interface StaffPinUser {
  id: string;
  name: string;
  hasPin: boolean;
}

interface StaffPinModalProps {
  user: StaffPinUser | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (pin: string | null) => Promise<void>;
}

const STAFF_PIN_PATTERN = /^\d{6}$/;

export function StaffPinModal({ user, isSaving, error, onClose, onSubmit }: StaffPinModalProps) {
  const { t } = useTranslation('settings');
  const [pin, setPin] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const handleSave = async () => {
    if (!STAFF_PIN_PATTERN.test(pin)) {
      setValidationError(t('users.staffPin.invalid'));
      return;
    }
    setValidationError(null);
    await onSubmit(pin);
  };

  if (confirmClear) {
    return (
      <ConfirmModal
        isOpen={user !== null}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void onSubmit(null)}
        title={t('users.staffPin.title')}
        message={t('users.staffPin.clearConfirm', { name: user?.name ?? '' })}
        confirmText={t('users.staffPin.clear')}
        cancelText={t('users.staffPin.cancel')}
        loading={isSaving}
      />
    );
  }

  return (
    <Modal
      isOpen={user !== null}
      onClose={onClose}
      title={t('users.staffPin.title')}
      size="sm"
      footer={
        <>
          {user?.hasPin && (
            <ModalButton
              variant="danger"
              onClick={() => setConfirmClear(true)}
              disabled={isSaving}
              className="sm:mr-auto"
            >
              {t('users.staffPin.clear')}
            </ModalButton>
          )}
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('users.staffPin.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t('users.staffPin.saving') : t('users.staffPin.save')}
          </ModalButton>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <p className="text-sm text-secondary-600">
          {t('users.staffPin.description', { name: user?.name ?? '' })}
        </p>
        <div>
          <label htmlFor="staff-pin" className="label">
            {t('users.staffPin.label')}
          </label>
          <input
            id="staff-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="input mt-1 font-mono tracking-[0.35em]"
            value={pin}
            onChange={event => {
              setPin(event.target.value.replace(/\D/g, '').slice(0, 6));
              setValidationError(null);
            }}
            placeholder={t('users.staffPin.placeholder')}
            aria-describedby="staff-pin-requirement"
          />
          <p id="staff-pin-requirement" className="mt-2 text-xs text-fg2">
            {t('users.staffPin.requirement')}
          </p>
        </div>
        {(validationError || error) && (
          <p role="alert" className="text-sm text-danger-600">
            {validationError ?? error}
          </p>
        )}
      </form>
    </Modal>
  );
}
