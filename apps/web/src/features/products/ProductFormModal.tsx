import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { useProductForm } from './useProductForm';
import { ProductGeneralTab } from './ProductGeneralTab';
import { ProductPricingTab } from './ProductPricingTab';
import { ProductUnitsTab } from './ProductUnitsTab';
import { ProductProvidersTab } from './ProductProvidersTab';
import type { ProductFormModalProps, ProductFormTab } from './productForm.types';

// Re-exported for the existing consumers (ProductsPage, QuickCreateProductGate)
// and ProductFormModal.test.tsx, which import these types from this module.
export type {
  LookupOption,
  VatRateOption,
  ProductFormValues,
} from './productForm.types';

export function ProductFormModal({
  mode,
  isOpen,
  product,
  categories,
  locations,
  providers,
  units,
  vatRates,
  isSaving,
  error,
  onClose,
  onSubmit,
  defaultName,
  onCreated,
}: ProductFormModalProps) {
  const { t } = useTranslation('products');
  const formBundle = useProductForm({ mode, product, defaultName, onSubmit, onCreated });
  const { form, handleSubmit, isActive } = formBundle;
  const [activeTab, setActiveTab] = useState<ProductFormTab>('general');

  const PRODUCT_FORM_TABS: Array<{ id: ProductFormTab; label: string }> = [
    { id: 'general', label: t('form.tabs.general') },
    { id: 'pricing', label: t('form.tabs.pricing') },
    { id: 'units', label: t('form.tabs.units') },
    { id: 'providers', label: t('form.tabs.providers') },
  ];

  // ENG-078 — Gate: only fires when the semantic-search module is active AND
  // the caller has manager+ role. Cashiers never reach this modal but we still
  // defend.
  const auth = useAuth();
  const semanticSearchActive = useIsModuleActive('semantic-search');
  const suggestionsEnabled =
    semanticSearchActive &&
    (auth.user?.role === 'admin' || auth.user?.role === 'manager');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? t('form.createTitle') : t('form.editTitle')}
      size="xl"
      footer={
        <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            id="product-is-active"
            className="inline-flex items-center gap-2.5 text-sm text-secondary-600"
            onClick={() =>
              form.setValue('isActive', !isActive, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          >
            <span className={cn('pv-switch', isActive && 'on')} aria-hidden="true" />
            {t('form.fields.isActive')}
          </button>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button type="button" className="pv-btn outline" onClick={onClose} disabled={isSaving}>
              {t('form.cancel')}
            </button>
            <button type="button" className="pv-btn primary" onClick={handleSubmit} disabled={isSaving}>
              {mode === 'create' && <Plus aria-hidden="true" />}
              {isSaving ? t('form.submitting') : mode === 'create' ? t('form.create') : t('form.save')}
            </button>
          </div>
        </div>
      }
    >
      <div className="pv-tabs mb-6" role="tablist" aria-label={t('form.tabs.ariaLabel')}>
        {PRODUCT_FORM_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`product-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`product-tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form className="space-y-6" onSubmit={handleSubmit}>
        {activeTab === 'general' && (
          <ProductGeneralTab
            formBundle={formBundle}
            mode={mode}
            isOpen={isOpen}
            categories={categories}
            providers={providers}
            locations={locations}
            vatRates={vatRates}
            suggestionsEnabled={suggestionsEnabled}
            productId={product?.id}
          />
        )}

        {activeTab === 'pricing' && <ProductPricingTab formBundle={formBundle} />}

        {activeTab === 'units' && <ProductUnitsTab formBundle={formBundle} units={units} />}

        {activeTab === 'providers' && (
          <ProductProvidersTab formBundle={formBundle} providers={providers} />
        )}

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
