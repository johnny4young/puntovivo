import { ShieldAlert, Snowflake } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SimpleFormField } from '@/components/form-controls/FormField';
import { cn } from '@/lib/utils';
import type { PharmacyProductProfile, PharmacyProfileLockReason } from '@/types';
import { ProductFormFieldGroup } from './ProductFormFieldGroup';
import type { UseProductFormReturn } from './useProductForm';

const CLASSIFICATION_RANK = { otc: 0, prescription: 1, controlled: 2 } as const;

interface ProductPharmacyTabProps {
  formBundle: UseProductFormReturn;
  existingClassification?: PharmacyProductProfile['classification'] | undefined;
  existingSanitaryRegistration?: string | null | undefined;
  existingRequiresColdChain?: boolean | undefined;
  profileLocks?: PharmacyProfileLockReason[] | undefined;
}

export function ProductPharmacyTab({
  formBundle,
  existingClassification,
  existingSanitaryRegistration,
  existingRequiresColdChain,
  profileLocks = [],
}: ProductPharmacyTabProps) {
  const { t } = useTranslation(['products', 'pharmacy']);
  const { form, pharmacyEnabled, initialStock } = formBundle;
  const classification = form.watch('pharmacy.classification');
  const requiresColdChain = form.watch('pharmacy.requiresColdChain');
  const hasOperationalLock =
    initialStock > 0 || profileLocks.includes('stock') || profileLocks.includes('open_draft');
  const profileRemovalLocked =
    existingClassification !== undefined && (hasOperationalLock || profileLocks.length > 0);
  const classificationRelaxationLocked = existingClassification !== undefined && hasOperationalLock;
  const registrationLocked =
    Boolean(existingSanitaryRegistration?.trim()) &&
    (profileLocks.includes('lot_history') ||
      profileLocks.includes('evidence_history') ||
      profileLocks.includes('active_registration_recall'));
  const coldChainChangeLocked = existingRequiresColdChain !== undefined && hasOperationalLock;
  const coldChainField = form.register('pharmacy.requiresColdChain');

  const setPharmacyEnabled = (enabled: boolean) => {
    form.setValue('pharmacyEnabled', enabled, { shouldDirty: true, shouldValidate: true });
    if (enabled) {
      form.setValue('tracksStock', true, { shouldDirty: true, shouldValidate: true });
      form.setValue('tracksLots', true, { shouldDirty: true, shouldValidate: true });
      form.setValue('tracksSerials', false, { shouldDirty: true, shouldValidate: true });
    }
  };

  return (
    <div
      id="product-tabpanel-pharmacy"
      role="tabpanel"
      aria-labelledby="product-tab-pharmacy"
      className="space-y-8"
      data-testid="product-pharmacy-tab"
    >
      <section className="rounded-2xl border border-primary-200 bg-primary-50/70 p-5">
        <label className="flex items-start gap-3 text-sm font-semibold text-primary-950">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-primary-300"
            checked={pharmacyEnabled}
            disabled={profileRemovalLocked}
            onChange={event => setPharmacyEnabled(event.target.checked)}
          />
          <span>
            <span className="block">{t('pharmacy:product.enabled')}</span>
            <span className="mt-1 block font-normal text-primary-800">
              {t('pharmacy:product.enabledHelp')}
            </span>
          </span>
        </label>
        {profileRemovalLocked ? (
          <p className="mt-3 text-xs font-medium text-warning-800" role="status">
            {t('pharmacy:product.profileLocked')}
          </p>
        ) : null}
      </section>

      {!pharmacyEnabled ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface-2/60 p-8 text-center">
          <p className="text-sm font-medium text-secondary-800">{t('pharmacy:product.disabled')}</p>
          <p className="mt-1 text-sm text-secondary-600">{t('pharmacy:product.disabledHelp')}</p>
        </div>
      ) : (
        <>
          <ProductFormFieldGroup
            title={t('pharmacy:product.sections.identity.title')}
            description={t('pharmacy:product.sections.identity.description')}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <SimpleFormField
                label={t('pharmacy:product.fields.activeIngredient')}
                htmlFor="product-pharmacy-active-ingredient"
              >
                <input
                  id="product-pharmacy-active-ingredient"
                  className="pv-input"
                  maxLength={255}
                  {...form.register('pharmacy.activeIngredient')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.genericName')}
                htmlFor="product-pharmacy-generic-name"
              >
                <input
                  id="product-pharmacy-generic-name"
                  className="pv-input"
                  maxLength={255}
                  {...form.register('pharmacy.genericName')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.concentration')}
                htmlFor="product-pharmacy-concentration"
              >
                <input
                  id="product-pharmacy-concentration"
                  className="pv-input"
                  maxLength={120}
                  {...form.register('pharmacy.concentration')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.dosageForm')}
                htmlFor="product-pharmacy-dosage-form"
              >
                <input
                  id="product-pharmacy-dosage-form"
                  className="pv-input"
                  maxLength={120}
                  {...form.register('pharmacy.dosageForm')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.administrationRoute')}
                htmlFor="product-pharmacy-route"
              >
                <input
                  id="product-pharmacy-route"
                  className="pv-input"
                  maxLength={120}
                  {...form.register('pharmacy.administrationRoute')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.presentation')}
                htmlFor="product-pharmacy-presentation"
              >
                <input
                  id="product-pharmacy-presentation"
                  className="pv-input"
                  maxLength={255}
                  {...form.register('pharmacy.presentation')}
                />
              </SimpleFormField>
            </div>
          </ProductFormFieldGroup>

          <ProductFormFieldGroup
            title={t('pharmacy:product.sections.regulatory.title')}
            description={t('pharmacy:product.sections.regulatory.description')}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <SimpleFormField
                label={t('pharmacy:product.fields.classification')}
                htmlFor="product-pharmacy-classification"
              >
                <select
                  id="product-pharmacy-classification"
                  className="pv-input"
                  {...form.register('pharmacy.classification')}
                >
                  {(['otc', 'prescription', 'controlled'] as const).map(value => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        classificationRelaxationLocked &&
                        existingClassification !== undefined &&
                        CLASSIFICATION_RANK[value] < CLASSIFICATION_RANK[existingClassification]
                      }
                    >
                      {t(`pharmacy:product.classifications.${value}`)}
                    </option>
                  ))}
                </select>
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.sanitaryRegistration')}
                htmlFor="product-pharmacy-registration"
                helperText={t('pharmacy:product.fields.sanitaryRegistrationHelp')}
              >
                <input
                  id="product-pharmacy-registration"
                  className="pv-input"
                  maxLength={160}
                  readOnly={registrationLocked}
                  {...form.register('pharmacy.sanitaryRegistration')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.registrationExpiresAt')}
                htmlFor="product-pharmacy-registration-expiry"
              >
                <input
                  id="product-pharmacy-registration-expiry"
                  type="date"
                  className="pv-input"
                  {...form.register('pharmacy.registrationExpiresAt')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.manufacturer')}
                htmlFor="product-pharmacy-manufacturer"
              >
                <input
                  id="product-pharmacy-manufacturer"
                  className="pv-input"
                  maxLength={255}
                  {...form.register('pharmacy.manufacturer')}
                />
              </SimpleFormField>
              <SimpleFormField
                label={t('pharmacy:product.fields.authorizationHolder')}
                htmlFor="product-pharmacy-holder"
              >
                <input
                  id="product-pharmacy-holder"
                  className="pv-input"
                  maxLength={255}
                  {...form.register('pharmacy.authorizationHolder')}
                />
              </SimpleFormField>
            </div>

            {classification === 'controlled' ? (
              <div
                className="flex gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900"
                role="alert"
              >
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <p>{t('pharmacy:product.controlledBlocked')}</p>
              </div>
            ) : classification === 'prescription' ? (
              <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900">
                {t('pharmacy:product.prescriptionNotice')}
              </div>
            ) : null}
          </ProductFormFieldGroup>

          <ProductFormFieldGroup
            title={t('pharmacy:product.sections.storage.title')}
            description={t('pharmacy:product.sections.storage.description')}
          >
            <SimpleFormField
              label={t('pharmacy:product.fields.storageConditions')}
              htmlFor="product-pharmacy-storage"
            >
              <textarea
                id="product-pharmacy-storage"
                className="pv-input area"
                maxLength={500}
                {...form.register('pharmacy.storageConditions')}
              />
            </SimpleFormField>
            <label
              className={cn(
                'flex items-start gap-3 rounded-2xl border p-4 text-sm',
                requiresColdChain
                  ? 'border-sky-200 bg-sky-50 text-sky-950'
                  : 'border-line bg-surface-2/50 text-secondary-900'
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded"
                {...coldChainField}
                checked={Boolean(requiresColdChain)}
                aria-disabled={coldChainChangeLocked}
                onChange={event => {
                  if (coldChainChangeLocked) {
                    // Keep the locked value in the form submission while also
                    // restoring the DOM state after pointer or keyboard input.
                    // A native disabled field would be omitted by react-hook-form.
                    event.currentTarget.checked = Boolean(requiresColdChain);
                    return;
                  }
                  void coldChainField.onChange(event);
                }}
              />
              <Snowflake className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>
                <span className="block font-semibold">
                  {t('pharmacy:product.fields.requiresColdChain')}
                </span>
                <span className="mt-1 block font-normal">
                  {t('pharmacy:product.fields.requiresColdChainHelp')}
                </span>
              </span>
            </label>
            {coldChainChangeLocked ? (
              <p className="text-xs font-medium text-warning-800" role="status">
                {t('pharmacy:product.coldChainLocked')}
              </p>
            ) : null}
          </ProductFormFieldGroup>
        </>
      )}
    </div>
  );
}
