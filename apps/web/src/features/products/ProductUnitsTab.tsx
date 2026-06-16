import { useTranslation } from 'react-i18next';
import { useWatch } from 'react-hook-form';
import type { LookupOption } from './productForm.types';
import type { UseProductFormReturn } from './useProductForm';

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
            <p className="text-sm text-secondary-500">
              {t('form.units.description')}
            </p>
          </div>
          <button
            type="button"
            className="pv-btn outline"
            onClick={() =>
              unitAssignmentsFieldArray.append({
                unitId: '',
                equivalence: 1,
                price: form.getValues('price'),
                isBase: false,
              })
            }
          >
            {t('form.units.addUnit')}
          </button>
        </div>

        <div className="space-y-4">
          {unitAssignmentsFieldArray.fields.map((field, index) => {
            const isBase = unitAssignments?.[index]?.isBase ?? false;
            return (
              <div key={field.id} className="grid grid-cols-2 gap-4 rounded-lg border border-secondary-200 p-4">
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
                    className="pv-input"
                    {...form.register(`unitAssignments.${index}.equivalence` as const, {
                      min: 0.01,
                      valueAsNumber: true,
                    })}
                  />
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
                  <button
                    type="button"
                    className="pv-btn ghost text-danger-600"
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
                  >
                    {t('form.units.remove')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
