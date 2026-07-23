import { useTranslation } from 'react-i18next';
import { useWatch } from 'react-hook-form';
import type { LookupOption } from './productForm.types';
import { validateSerialUnitEquivalence } from './serialTracking';
import type { UseProductFormReturn } from './useProductForm';
import { Button } from '@/components/ui';
interface ProductUnitsTabProps {
  formBundle: UseProductFormReturn;
  units: LookupOption[];
}
export function ProductUnitsTab({ formBundle, units }: ProductUnitsTabProps) {
  const { t } = useTranslation('products');
  const { form, unitAssignmentsFieldArray, handleBaseUnitChange: onBaseUnitChange } = formBundle;
  const unitAssignments = useWatch({
    control: form.control,
    name: 'unitAssignments',
  });
  return (
    <div id="product-tabpanel-units" role="tabpanel" aria-labelledby="product-tab-units">
      <div className="space-y-4 rounded-xl border border-secondary-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-secondary-900">{t('form.units.title')}</p>
            <p className="text-sm text-secondary-500">{t('form.units.description')}</p>
          </div>
          <Button
            type="button"
            onClick={() =>
              unitAssignmentsFieldArray.append({
                unitId: '',
                equivalence: 1,
                price: form.getValues('price'),
                isBase: false,
              })
            }
            variant="outline"
          >
            {t('form.units.addUnit')}
          </Button>
        </div>

        <div className="space-y-4">
          {unitAssignmentsFieldArray.fields.map((field, index) => {
            const isBase = unitAssignments?.[index]?.isBase ?? false;
            const equivalenceError =
              form.formState.errors.unitAssignments?.[index]?.equivalence?.message;
            return (
              <div
                key={field.id}
                className="grid grid-cols-2 gap-4 rounded-lg border border-secondary-200 p-4"
              >
                <div className="pv-field">
                  <label className="label">{t('form.units.unit')}</label>
                  <select
                    className="pv-input"
                    {...form.register(`unitAssignments.${index}.unitId` as const, {
                      required: t('form.units.unitRequired'),
                    })}
                  >
                    <option value="">{t('form.units.selectUnit')}</option>
                    {units.map(unit => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="pv-field">
                  <label className="label">{t('form.units.equivalence')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    disabled={isBase}
                    className={`pv-input ${equivalenceError ? 'error' : ''}`}
                    {...form.register(`unitAssignments.${index}.equivalence` as const, {
                      min: 0.01,
                      valueAsNumber: true,
                      validate: value =>
                        validateSerialUnitEquivalence(
                          form.getValues('tracksSerials'),
                          value,
                          t('form.units.serialEquivalenceRequired')
                        ),
                    })}
                  />
                  {equivalenceError && (
                    <p className="mt-1 text-sm text-danger-500">{equivalenceError}</p>
                  )}
                </div>
                <div className="pv-field">
                  <label className="label">{t('form.units.unitPrice')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="pv-input"
                    {...form.register(`unitAssignments.${index}.price` as const, {
                      min: 0,
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm text-secondary-700">
                    <input
                      type="checkbox"
                      checked={!!isBase}
                      onChange={() => onBaseUnitChange(index)}
                    />
                    {t('form.units.baseUnit')}
                  </label>
                  <Button
                    type="button"
                    className="text-danger-600"
                    disabled={unitAssignmentsFieldArray.fields.length === 1}
                    onClick={() => {
                      const currentAssignments = form.getValues('unitAssignments');
                      const removingBase = currentAssignments[index]?.isBase;
                      unitAssignmentsFieldArray.remove(index);
                      if (removingBase && currentAssignments.length > 1) {
                        const nextIndex = index === 0 ? 0 : index - 1;
                        onBaseUnitChange(nextIndex);
                      }
                    }}
                    variant="ghost"
                  >
                    {t('form.units.remove')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
