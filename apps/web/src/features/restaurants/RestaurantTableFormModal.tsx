/**
 * ENG-039b — create/edit form modal for the restaurant table catalog.
 */
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

export interface RestaurantTableFormValues {
  name: string;
  seatCount: string;
  area: string;
  notes: string;
}

export interface RestaurantTableFormPayload {
  name: string;
  seatCount: number | null;
  area: string | null;
  notes: string | null;
}

export interface RestaurantTableFormInitial {
  id: string;
  name: string;
  seatCount: number | null;
  area: string | null;
  notes: string | null;
}

const defaultValues: RestaurantTableFormValues = {
  name: '',
  seatCount: '',
  area: '',
  notes: '',
};

function mapInitialToForm(
  initial: RestaurantTableFormInitial | null
): RestaurantTableFormValues {
  if (!initial) return defaultValues;
  return {
    name: initial.name,
    seatCount: initial.seatCount !== null ? String(initial.seatCount) : '',
    area: initial.area ?? '',
    notes: initial.notes ?? '',
  };
}

function parseFormPayload(
  values: RestaurantTableFormValues
): RestaurantTableFormPayload {
  const trimmedName = values.name.trim();
  const trimmedArea = values.area.trim();
  const trimmedNotes = values.notes.trim();
  const trimmedSeatCount = values.seatCount.trim();
  const parsedSeat = trimmedSeatCount.length > 0 ? Number(trimmedSeatCount) : null;
  return {
    name: trimmedName,
    seatCount: parsedSeat !== null && Number.isFinite(parsedSeat) ? parsedSeat : null,
    area: trimmedArea.length > 0 ? trimmedArea : null,
    notes: trimmedNotes.length > 0 ? trimmedNotes : null,
  };
}

interface RestaurantTableFormModalProps {
  isOpen: boolean;
  initial: RestaurantTableFormInitial | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: RestaurantTableFormPayload) => Promise<void>;
}

export function RestaurantTableFormModal({
  isOpen,
  initial,
  isSaving,
  error,
  onClose,
  onSubmit,
}: RestaurantTableFormModalProps) {
  const { t } = useTranslation('restaurants');
  const form = useForm<RestaurantTableFormValues>({
    defaultValues: mapInitialToForm(initial),
  });

  const handleSubmit = form.handleSubmit(async values => {
    await onSubmit(parseFormPayload(values));
  });

  const isCreate = !initial;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        isCreate ? t('tables.form.createTitle') : t('tables.form.editTitle')
      }
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('tables.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('tables.form.saving') : t('tables.form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="restaurant-table-name" className="label">
            {t('tables.form.nameLabel')}
          </label>
          <input
            id="restaurant-table-name"
            data-testid="restaurant-table-name"
            className="input mt-1"
            placeholder={t('tables.form.namePlaceholder')}
            {...form.register('name', {
              required: t('tables.form.nameRequired'),
              setValueAs: value => (typeof value === 'string' ? value : ''),
            })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="restaurant-table-seat-count" className="label">
              {t('tables.form.seatCountLabel')}
            </label>
            <input
              id="restaurant-table-seat-count"
              data-testid="restaurant-table-seat-count"
              className="input mt-1"
              type="number"
              min={1}
              max={200}
              {...form.register('seatCount')}
            />
          </div>
          <div>
            <label htmlFor="restaurant-table-area" className="label">
              {t('tables.form.areaLabel')}
            </label>
            <input
              id="restaurant-table-area"
              data-testid="restaurant-table-area"
              className="input mt-1"
              placeholder={t('tables.form.areaPlaceholder')}
              {...form.register('area')}
            />
          </div>
        </div>

        <div>
          <label htmlFor="restaurant-table-notes" className="label">
            {t('tables.form.notesLabel')}
          </label>
          <textarea
            id="restaurant-table-notes"
            data-testid="restaurant-table-notes"
            className="input mt-1 min-h-[88px]"
            {...form.register('notes')}
          />
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
