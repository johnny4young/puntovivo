import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

export interface CashSessionMovementValues {
  type: 'paid_in' | 'paid_out' | 'skim' | 'replenishment';
  amount: number;
  note: string;
}

interface CashSessionMovementModalProps {
  isOpen: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: CashSessionMovementValues) => Promise<void>;
}

function createDefaultValues(): CashSessionMovementValues {
  return {
    type: 'paid_in',
    amount: 0,
    note: '',
  };
}

export function CashSessionMovementModal({
  isOpen,
  isSaving,
  error,
  onClose,
  onSubmit,
}: CashSessionMovementModalProps) {
  const { t } = useTranslation('sales');
  const form = useForm<CashSessionMovementValues>({
    defaultValues: createDefaultValues(),
  });
  const handleSubmit = form.handleSubmit(onSubmit);
  const selectedType = useWatch({
    control: form.control,
    name: 'type',
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={t('cashSession.movementForm.title')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('cashSession.movementForm.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving
              ? t('cashSession.movementForm.saving')
              : t('cashSession.movementForm.confirm')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="surface-panel-muted p-4">
          <p className="text-sm text-secondary-700">
            {t('cashSession.movementForm.description')}
          </p>
          <p className="mt-2 text-sm text-secondary-500">
            {t(`cashSession.movementForm.typeHints.${selectedType}`)}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,160px)]">
          <div>
            <label htmlFor="cash-session-movement-type" className="label">
              {t('cashSession.movementForm.type')}
            </label>
            <select
              id="cash-session-movement-type"
              className="input mt-1"
              {...form.register('type')}
            >
              <option value="paid_in">{t('cashSession.movementTypes.paid_in')}</option>
              <option value="paid_out">{t('cashSession.movementTypes.paid_out')}</option>
              <option value="skim">{t('cashSession.movementTypes.skim')}</option>
              <option value="replenishment">
                {t('cashSession.movementTypes.replenishment')}
              </option>
            </select>
          </div>

          <div>
            <label htmlFor="cash-session-movement-amount" className="label">
              {t('cashSession.movementForm.amount')}
            </label>
            <input
              id="cash-session-movement-amount"
              type="number"
              min={0.01}
              step="0.01"
              className="input mt-1"
              {...form.register('amount', {
                valueAsNumber: true,
                min: {
                  value: 0.01,
                  message: t('cashSession.movementForm.amountRequired'),
                },
              })}
            />
            {form.formState.errors.amount && (
              <p className="mt-1 text-sm text-danger-500">
                {form.formState.errors.amount.message}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="cash-session-movement-note" className="label">
            {t('cashSession.movementForm.note')}
          </label>
          <textarea
            id="cash-session-movement-note"
            rows={4}
            className="input mt-1 min-h-[112px]"
            {...form.register('note', {
              required: t('cashSession.movementForm.noteRequired'),
              minLength: {
                value: 3,
                message: t('cashSession.movementForm.noteRequired'),
              },
              maxLength: {
                value: 240,
                message: t('cashSession.movementForm.noteTooLong'),
              },
            })}
          />
          {form.formState.errors.note && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.note.message}</p>
          )}
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
