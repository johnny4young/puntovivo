import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useAuth } from './AuthProvider';

interface StaffSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STAFF_PIN_PATTERN = /^\d{6}$/;

export function StaffSwitchModal({ isOpen, onClose }: StaffSwitchModalProps) {
  const { t } = useTranslation(['auth', 'errors']);
  const { switchStaff } = useAuth();
  const cashiersQuery = trpc.auth.switchableCashiers.useQuery(undefined, { enabled: isOpen });
  const [targetUserId, setTargetUserId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cashiers = useMemo(() => cashiersQuery.data ?? [], [cashiersQuery.data]);

  const handleSubmit = async () => {
    if (!targetUserId) {
      setError(t('auth:staffSwitch.selectRequired'));
      return;
    }
    if (!STAFF_PIN_PATTERN.test(pin)) {
      setError(t('auth:staffSwitch.pinRequired'));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await switchStaff({ targetUserId, pin });
      onClose();
    } catch (err) {
      setError(translateServerError(err, t, t('errors:server.AUTH_STAFF_PIN_INVALID')));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('auth:staffSwitch.title')}
      size="sm"
      closeOnBackdrop={!isSubmitting}
      closeOnEsc={!isSubmitting}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSubmitting}>
            {t('auth:staffSwitch.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || cashiersQuery.isLoading || cashiers.length === 0}
          >
            {isSubmitting ? t('auth:staffSwitch.submitting') : t('auth:staffSwitch.submit')}
          </ModalButton>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={event => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <p className="text-sm text-secondary-600">{t('auth:staffSwitch.description')}</p>

        {cashiersQuery.isLoading ? (
          <p className="text-sm text-fg2">{t('auth:staffSwitch.loading')}</p>
        ) : cashiers.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-fg2">
            {t('auth:staffSwitch.empty')}
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="label">{t('auth:staffSwitch.cashierLabel')}</legend>
            {cashiers.map(cashier => (
              <label
                key={cashier.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50"
              >
                <input
                  type="radio"
                  name="staff-switch-cashier"
                  value={cashier.id}
                  checked={targetUserId === cashier.id}
                  onChange={() => {
                    setTargetUserId(cashier.id);
                    setError(null);
                  }}
                  disabled={!cashier.hasPin || isSubmitting}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-secondary-950">
                    {cashier.name}
                  </span>
                  {!cashier.hasPin && (
                    <span className="block text-xs text-warning-700">
                      {t('auth:staffSwitch.notConfigured')}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div>
          <label htmlFor="staff-switch-pin" className="label">
            {t('auth:staffSwitch.pinLabel')}
          </label>
          <input
            id="staff-switch-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="input mt-1 font-mono tracking-[0.35em]"
            value={pin}
            onChange={event => {
              setPin(event.target.value.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder={t('auth:staffSwitch.pinPlaceholder')}
            aria-describedby="staff-switch-pin-hint"
            disabled={cashiers.length === 0 || isSubmitting}
          />
          <p id="staff-switch-pin-hint" className="mt-2 text-xs text-fg2">
            {t('auth:staffSwitch.pinHint')}
          </p>
        </div>

        {(error || cashiersQuery.error) && (
          <p role="alert" className="text-sm text-danger-600">
            {error ?? cashiersQuery.error?.message}
          </p>
        )}
      </form>
    </Modal>
  );
}
