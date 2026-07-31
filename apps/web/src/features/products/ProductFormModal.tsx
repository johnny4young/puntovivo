import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Plus } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useUnsavedChangesGuard } from '@/components/navigation/useUnsavedChangesGuard';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { useProductForm } from './useProductForm';
import { ProductGeneralTab } from './ProductGeneralTab';
import {
  ProductUnsavedChangesActions,
  ProductUnsavedChangesBody,
} from './ProductUnsavedChangesPrompt';
import type {
  ProductFormExperience,
  ProductFormModalProps,
  ProductFormTab,
} from './productForm.types';

// Re-exported for the existing consumers (ProductsPage, QuickCreateProductGate)
// and ProductFormModal.test.tsx, which import these types from this module.
import { Button } from '@/components/ui';

const ProductQuickCreatePanel = lazy(() =>
  import('./ProductQuickCreatePanel').then(module => ({
    default: module.ProductQuickCreatePanel,
  }))
);
const ProductPricingTab = lazy(() =>
  import('./ProductPricingTab').then(module => ({
    default: module.ProductPricingTab,
  }))
);
const ProductUnitsTab = lazy(() =>
  import('./ProductUnitsTab').then(module => ({
    default: module.ProductUnitsTab,
  }))
);
const ProductProvidersTab = lazy(() =>
  import('./ProductProvidersTab').then(module => ({
    default: module.ProductProvidersTab,
  }))
);
const PRODUCT_UNSAVED_KEEP_EDITING_BUTTON_ID = 'product-unsaved-keep-editing';

export type { LookupOption, VatRateOption, ProductFormValues } from './productForm.types';
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
  initialExperience = 'advanced',
  origin = 'catalog',
  onExperienceChange,
  advancedLookupsPending = false,
  onInvalid,
}: ProductFormModalProps) {
  const { t } = useTranslation('products');
  const { t: tQuick } = useTranslation('productQuickCreate');
  const formBundle = useProductForm({
    mode,
    product,
    defaultName,
    onSubmit,
    onCreated,
    onInvalid,
  });
  const { form, handleSubmit, isActive } = formBundle;
  const isDirty = form.formState.isDirty;
  const formRef = useRef<HTMLFormElement>(null);
  const wasExitConfirmationOpen = useRef(false);
  const [activeTab, setActiveTab] = useState<ProductFormTab>('general');
  const [experience, setExperience] = useState<ProductFormExperience>(() =>
    mode === 'edit' ? 'advanced' : initialExperience
  );
  const isQuickExperience = mode === 'create' && experience === 'quick';
  const PRODUCT_FORM_TABS: Array<{
    id: ProductFormTab;
    label: string;
  }> = [
    {
      id: 'general',
      label: t('form.tabs.general'),
    },
    {
      id: 'pricing',
      label: t('form.tabs.pricing'),
    },
    {
      id: 'units',
      label: t('form.tabs.units'),
    },
    {
      id: 'providers',
      label: t('form.tabs.providers'),
    },
  ];

  // Gate: only fires when the semantic-search module is active AND
  // the caller has manager+ role. Cashiers never reach this modal but we still
  // defend.
  const auth = useAuth();
  const semanticSearchActive = useIsModuleActive('semantic-search');
  const suggestionsEnabled =
    semanticSearchActive && (auth.user?.role === 'admin' || auth.user?.role === 'manager');

  const openAdvancedExperience = () => {
    setExperience('advanced');
    onExperienceChange?.('advanced');
  };

  const { requestClose, isExitConfirmationOpen, keepEditing, discardChanges } =
    useUnsavedChangesGuard({ when: isOpen && isDirty, onClose });
  const handleRequestClose = () => {
    if (!isSaving) requestClose();
  };

  useEffect(() => {
    const confirmationWasOpen = wasExitConfirmationOpen.current;
    wasExitConfirmationOpen.current = isExitConfirmationOpen;

    if (!isOpen) return;
    const focusTimer = window.setTimeout(() => {
      if (isExitConfirmationOpen) {
        document.getElementById(PRODUCT_UNSAVED_KEEP_EDITING_BUTTON_ID)?.focus();
        return;
      }
      if (confirmationWasOpen) {
        formRef.current
          ?.querySelector<HTMLElement>(
            'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
          )
          ?.focus();
      }
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isExitConfirmationOpen, isOpen]);

  const regularFooter = (
    <div
      className={cn(
        'flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center',
        isQuickExperience ? 'sm:justify-end' : 'sm:justify-between'
      )}
    >
      {!isQuickExperience && (
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
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button type="button" onClick={handleRequestClose} disabled={isSaving} variant="outline">
          {t('form.cancel')}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={isSaving} variant="primary">
          {mode === 'create' && <Plus aria-hidden="true" />}
          {isSaving ? t('form.submitting') : mode === 'create' ? t('form.create') : t('form.save')}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      title={
        isExitConfirmationOpen
          ? t('form.unsavedChanges.title')
          : mode === 'create'
            ? t('form.createTitle')
            : t('form.editTitle')
      }
      size={isQuickExperience ? 'lg' : 'xl'}
      closeOnBackdrop={!isSaving && !isExitConfirmationOpen}
      closeOnEsc={!isSaving && !isExitConfirmationOpen}
      showCloseButton={!isExitConfirmationOpen}
      className={
        isQuickExperience
          ? 'sm:max-h-[96vh] [&_.modal-body]:py-4 [&_.modal-footer]:py-3 [&_.modal-header]:py-3'
          : undefined
      }
      footer={
        isExitConfirmationOpen ? (
          <ProductUnsavedChangesActions onKeepEditing={keepEditing} onDiscard={discardChanges} />
        ) : (
          regularFooter
        )
      }
    >
      {isExitConfirmationOpen ? (
        <ProductUnsavedChangesBody />
      ) : null}
      <form
        ref={formRef}
        className="space-y-6"
        onSubmit={handleSubmit}
        hidden={isExitConfirmationOpen}
        aria-hidden={isExitConfirmationOpen}
      >
        {isDirty ? (
          <p role="status" className="text-sm font-medium text-warning-700">
            {t('form.unsavedChanges.status')}
          </p>
        ) : null}
        {isQuickExperience ? (
          <Suspense
            fallback={
              <div
                className="min-h-[24rem] animate-pulse rounded-[1.5rem] border border-line bg-surface-2/65"
                role="status"
                aria-label={tQuick('loadingQuick')}
              />
            }
          >
            <ProductQuickCreatePanel
              formBundle={formBundle}
              vatRates={vatRates}
              origin={origin}
              onOpenAdvanced={openAdvancedExperience}
            />
          </Suspense>
        ) : advancedLookupsPending ? (
          <div
            className="flex min-h-[22rem] flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-line bg-surface-2/60 px-6 text-center"
            role="status"
            aria-live="polite"
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-primary-800 shadow-sm">
              <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-secondary-900">{tQuick('loadingAdvanced')}</p>
          </div>
        ) : (
          <>
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

            <Suspense
              fallback={
                <div
                  className="min-h-[16rem] animate-pulse rounded-[1.5rem] border border-line bg-surface-2/65"
                  role="status"
                  aria-label={tQuick('loadingAdvanced')}
                />
              }
            >
              {activeTab === 'pricing' && <ProductPricingTab formBundle={formBundle} />}

              {activeTab === 'units' && (
                <ProductUnitsTab
                  formBundle={formBundle}
                  units={units}
                  allowEmpty={mode === 'create'}
                />
              )}

              {activeTab === 'providers' && (
                <ProductProvidersTab formBundle={formBundle} providers={providers} />
              )}
            </Suspense>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger-500">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
