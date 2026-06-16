import { useTranslation } from 'react-i18next';
import type { LookupOption } from './productForm.types';
import type { UseProductFormReturn } from './useProductForm';

interface ProductProvidersTabProps {
  formBundle: UseProductFormReturn;
  providers: LookupOption[];
}

export function ProductProvidersTab({ formBundle, providers }: ProductProvidersTabProps) {
  const { t } = useTranslation('products');
  const { form, providerAssignmentsFieldArray, validateProviderAssignment } = formBundle;
  return (
    <div
      id="product-tabpanel-providers"
      role="tabpanel"
      aria-labelledby="product-tab-providers"
    >
      <div className="space-y-4 rounded-xl border border-secondary-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-secondary-900">{t('form.providerAssignments.title')}</p>
            <p className="text-sm text-secondary-500">{t('form.providerAssignments.description')}</p>
          </div>
          <button
            type="button"
            className="pv-btn outline"
            onClick={() => providerAssignmentsFieldArray.append({ providerId: '' })}
          >
            {t('form.providerAssignments.addProvider')}
          </button>
        </div>

        {providerAssignmentsFieldArray.fields.length === 0 && (
          <p className="py-4 text-center text-sm text-secondary-500">
            {t('form.providerAssignments.empty')}
          </p>
        )}

        <div className="space-y-3">
          {providerAssignmentsFieldArray.fields.map((field, index) => (
            <div key={field.id} className="flex items-end gap-3 rounded-lg border border-secondary-200 p-4">
              <div className="pv-field flex-1">
                <label className="label">{t('form.providerAssignments.provider')}</label>
                <select
                  className="pv-input"
                  {...form.register(`providerAssignments.${index}.providerId` as const, {
                    validate: value => validateProviderAssignment(value, index),
                  })}
                >
                  <option value="">{t('form.providerAssignments.selectProvider')}</option>
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="pv-btn ghost text-danger-600"
                onClick={() => providerAssignmentsFieldArray.remove(index)}
              >
                {t('form.providerAssignments.remove')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
