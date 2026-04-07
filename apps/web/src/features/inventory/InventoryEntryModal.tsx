import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { InitialInventoryMode, ProductSearchSelection } from '@/types';

export interface InventoryEntryFormValues {
  mode: InitialInventoryMode;
  quantity: number;
  cost: number;
  notes: string;
}

interface InventoryEntryModalProps {
  isOpen: boolean;
  selection: ProductSearchSelection | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: InventoryEntryFormValues) => Promise<void>;
}

function mapSelectionToForm(selection: ProductSearchSelection | null): InventoryEntryFormValues {
  return {
    mode: 'initial',
    quantity: 1,
    cost: selection?.product.initialCost ?? selection?.product.cost ?? 0,
    notes: '',
  };
}

export function InventoryEntryModal({
  isOpen,
  selection,
  isSaving,
  error,
  onClose,
  onSubmit,
}: InventoryEntryModalProps) {
  const form = useForm<InventoryEntryFormValues>({
    defaultValues: mapSelectionToForm(selection),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const quantity = form.watch('quantity');
  const mode = form.watch('mode');
  const normalizedQuantity = quantity * (selection?.unit.equivalence ?? 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={selection ? `Record ${mode === 'initial' ? 'Initial' : 'Physical'} Inventory` : 'Record Inventory'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving || !selection}>
            {isSaving ? 'Saving...' : 'Save Entry'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {!selection ? (
          <p className="text-sm text-secondary-500">Select a product before recording inventory.</p>
        ) : (
          <>
            <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-secondary-900">{selection.product.name}</p>
                  <p className="text-sm text-secondary-500">
                    {selection.product.sku}
                    {selection.product.categoryName ? ` · ${selection.product.categoryName}` : ''}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-secondary-500">Current stock</p>
                  <p className="text-lg font-semibold text-secondary-900">{selection.product.stock}</p>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="inventory-entry-mode" className="label">
                Mode
              </label>
              <select
                id="inventory-entry-mode"
                className="input mt-1"
                {...form.register('mode')}
              >
                <option value="initial">Initial inventory (accumulate)</option>
                <option value="physical">Physical inventory (replace)</option>
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="inventory-entry-quantity" className="label">
                  Quantity
                </label>
                <input
                  id="inventory-entry-quantity"
                  type="number"
                  min={0.000001}
                  step="any"
                  className="input mt-1"
                  {...form.register('quantity', {
                    valueAsNumber: true,
                    min: { value: 0.000001, message: 'Quantity must be greater than zero' },
                  })}
                />
                {form.formState.errors.quantity && (
                  <p className="mt-1 text-sm text-danger-500">
                    {form.formState.errors.quantity.message}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="inventory-entry-cost" className="label">
                  Cost
                </label>
                <input
                  id="inventory-entry-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  className="input mt-1"
                  {...form.register('cost', {
                    valueAsNumber: true,
                    min: { value: 0, message: 'Cost must be zero or greater' },
                  })}
                />
                {form.formState.errors.cost && (
                  <p className="mt-1 text-sm text-danger-500">{form.formState.errors.cost.message}</p>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-secondary-200 bg-white px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-secondary-500">Unit</span>
                <span className="font-medium text-secondary-900">
                  {selection.unit.unitName ?? selection.unit.unitAbbreviation ?? selection.unit.unitId}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-secondary-500">Equivalence</span>
                <span className="font-medium text-secondary-900">{selection.unit.equivalence}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-secondary-500">Normalized quantity</span>
                <span className="font-medium text-secondary-900">{normalizedQuantity || 0}</span>
              </div>
            </div>

            <div>
              <label htmlFor="inventory-entry-notes" className="label">
                Notes
              </label>
              <textarea
                id="inventory-entry-notes"
                className="input mt-1 min-h-[96px]"
                placeholder="Optional reason or count reference"
                {...form.register('notes')}
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
