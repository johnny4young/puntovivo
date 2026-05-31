import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFieldArrayReturn,
  type UseFormReturn,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Plus, ScanLine, Sparkles, X } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { trpc } from '@/lib/trpc';
import type { Product } from '@/types';
import { calculatePricing } from './pricing';
import { normalizeProductProviderSelections } from './providerState';

/**
 * ENG-078 — Confidence thresholds for the AI category suggestion.
 *
 * HIGH (>= 0.7) triggers an auto-preselect in `create` mode when the
 * operator has not yet picked a category, plus a success-tone "Sugerido
 * por IA" badge next to the Categoría label.
 * MEDIUM (0.3..0.7) renders an inline chip below the dropdown with an
 * explicit "Aplicar sugerencia" CTA so the operator decides.
 * Below 0.3 is silent (the server already filters at the floor; we
 * defend on the client too).
 */
const HIGH_CONFIDENCE = 0.7;
const MEDIUM_CONFIDENCE_FLOOR = 0.3;
const SUGGEST_DEBOUNCE_MS = 800;

// ENG-179b — explicit `| undefined` on optional fields.
interface SuggestCategoryInput {
  name: string;
  description?: string | null | undefined;
}

function normalizeSuggestionDescription(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function matchesCurrentSuggestionInputs(
  variables: SuggestCategoryInput,
  current: Pick<ProductFormValues, 'name' | 'description'>
): boolean {
  return (
    variables.name.trim() === current.name.trim() &&
    normalizeSuggestionDescription(variables.description) ===
      normalizeSuggestionDescription(current.description)
  );
}

type ProductRole = 'create' | 'edit';

export interface LookupOption {
  id: string;
  name: string;
}

export interface VatRateOption extends LookupOption {
  rate: number;
}

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  providerId: string;
  vatRateId: string;
  locationId: string;
  barcode: string;
  imageUrl: string;
  cost: number;
  initialCost: number;
  price: number;
  price2: number;
  price3: number;
  marginPercent1: number;
  marginPercent2: number;
  marginPercent3: number;
  marginAmount1: number;
  marginAmount2: number;
  marginAmount3: number;
  taxRate: number;
  stock: number;
  minStock: number;
  sellByFraction: boolean;
  fractionStep: number;
  fractionMinimum: number;
  isActive: boolean;
  unitAssignments: ProductUnitAssignmentFormValues[];
  providerAssignments: ProductProviderAssignmentFormValues[];
}

export interface ProductUnitAssignmentFormValues {
  unitId: string;
  equivalence: number;
  price: number;
  isBase: boolean;
}

export interface ProductProviderAssignmentFormValues {
  providerId: string;
}

function createDefaultValues(): ProductFormValues {
  return {
    name: '',
    sku: '',
    description: '',
    categoryId: '',
    providerId: '',
    vatRateId: '',
    locationId: '',
    barcode: '',
    imageUrl: '',
    cost: 0,
    initialCost: 0,
    price: 0,
    price2: 0,
    price3: 0,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    stock: 0,
    minStock: 0,
    sellByFraction: false,
    fractionStep: 0.01,
    fractionMinimum: 0.01,
    isActive: true,
    unitAssignments: [{ unitId: '', equivalence: 1, price: 0, isBase: true }],
    providerAssignments: [],
  };
}

function mapProductToForm(product: Product | null): ProductFormValues {
  if (!product) {
    return createDefaultValues();
  }

  const normalizedProviders = normalizeProductProviderSelections(product);

  return {
    name: product.name,
    sku: product.sku,
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    providerId: normalizedProviders.primaryProviderId ?? '',
    vatRateId: product.vatRateId ?? '',
    locationId: product.locationId ?? '',
    barcode: product.barcode ?? '',
    imageUrl: product.imageUrl ?? '',
    cost: product.cost,
    initialCost: product.initialCost,
    price: product.price,
    price2: product.price2,
    price3: product.price3,
    marginPercent1: product.marginPercent1,
    marginPercent2: product.marginPercent2,
    marginPercent3: product.marginPercent3,
    marginAmount1: product.marginAmount1,
    marginAmount2: product.marginAmount2,
    marginAmount3: product.marginAmount3,
    taxRate: product.taxRate,
    stock: product.stock,
    minStock: product.minStock,
    sellByFraction: product.sellByFraction,
    fractionStep: product.fractionStep ?? 0.01,
    fractionMinimum: product.fractionMinimum ?? 0.01,
    isActive: product.isActive,
    unitAssignments:
      product.unitAssignments?.length
        ? product.unitAssignments.map(assignment => ({
            unitId: assignment.unitId,
            equivalence: assignment.equivalence,
            price: assignment.price,
            isBase: assignment.isBase,
          }))
        : [{ unitId: '', equivalence: 1, price: product.price, isBase: true }],
    providerAssignments: normalizedProviders.providerAssignments,
  };
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Builds the `error` prop for SimpleFormField under
 * `exactOptionalPropertyTypes`: the prop is omitted entirely when there is
 * no message rather than passed as `undefined`.
 */
function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

/**
 * Visual required marker. Renders the asterisk as a CSS `::after` pseudo
 * element on the field label so it stays presentation-only: it never lands
 * in the label's text content (keeping `getByLabelText('Name')` exact and
 * the accessible name clean — the required semantic is carried by
 * `aria-required` on the control instead).
 */
const REQUIRED_LABEL = "[&>label]:after:ml-0.5 [&>label]:after:text-danger-600 [&>label]:after:content-['*']";

/**
 * Subtitled field group used to organize the General tab into the three
 * documented sections (Identity · Classification · Inventory). Renders an
 * <h4> heading plus a muted one-line description above the grouped fields.
 */
interface FieldGroupProps {
  title: string;
  description: string;
  children: ReactNode;
}

function FieldGroup({ title, description, children }: FieldGroupProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-0.5">
        <h4 className="font-display text-lg leading-tight text-secondary-950">{title}</h4>
        <p className="text-sm text-secondary-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

interface ProductFormModalProps {
  mode: ProductRole;
  isOpen: boolean;
  product: Product | null;
  categories: LookupOption[];
  locations: LookupOption[];
  providers: LookupOption[];
  units: LookupOption[];
  vatRates: VatRateOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  /**
   * Persists the form. May return the newly created product so the
   * quick-create flow (ENG-105c) can hand it back to the caller via
   * `onCreated`. Existing callers that ignore the return value stay
   * backward compatible — TypeScript treats `Promise<Product | void>`
   * as compatible with a `Promise<void>` consumer.
   */
  onSubmit: (values: ProductFormValues) => Promise<Product | void>;
  /**
   * ENG-105c — pre-fill the `name` field on `mode='create'`. Useful
   * when the dialog is opened from the ProductSearchDialog empty
   * state with the typed query. Ignored on `mode='edit'` (the
   * existing product's name wins). Defaults to no pre-fill.
   */
  // ENG-179b — explicit `| undefined` on optional fields.
  defaultName?: string | undefined;
  /**
   * ENG-105c — fired once `onSubmit` succeeds AND `mode='create'`
   * AND the resolved value is a real product. Lets the caller add
   * the new product to the cart, attach to a sale, etc. Skipped on
   * error or on edit-mode submits.
   */
  onCreated?: ((product: Product) => void) | undefined;
}

type PricingField = 'price' | 'price2' | 'price3';
type MarginPercentField = 'marginPercent1' | 'marginPercent2' | 'marginPercent3';
type MarginAmountField = 'marginAmount1' | 'marginAmount2' | 'marginAmount3';
type ProductFormTab = 'general' | 'pricing' | 'units' | 'providers';

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
  const form = useForm<ProductFormValues>({
    defaultValues: (() => {
      const base = mapProductToForm(product);
      // ENG-105c — only pre-fill on create mode; edit-mode never
      // overwrites the product's existing name.
      if (mode === 'create' && defaultName && defaultName.length > 0) {
        return { ...base, name: defaultName };
      }
      return base;
    })(),
  });
  const [activeTab, setActiveTab] = useState<ProductFormTab>('general');
  // ENG-105c — wrap onSubmit so we can fire onCreated with the
  // returned product. handleSubmit from react-hook-form drops the
  // resolved value of the handler, so we capture it inside the
  // wrapper before the form library swallows it.
  const handleSubmit = form.handleSubmit(async values => {
    const result = await onSubmit(values);
    if (mode === 'create' && result && onCreated) {
      onCreated(result);
    }
  });
  const selectedVatRateId = useWatch({
    control: form.control,
    name: 'vatRateId',
  });
  const unitAssignmentsFieldArray = useFieldArray({
    control: form.control,
    name: 'unitAssignments',
  });
  const providerAssignmentsFieldArray = useFieldArray({
    control: form.control,
    name: 'providerAssignments',
  });

  const PRODUCT_FORM_TABS: Array<{ id: ProductFormTab; label: string }> = [
    { id: 'general', label: t('form.tabs.general') },
    { id: 'pricing', label: t('form.tabs.pricing') },
    { id: 'units', label: t('form.tabs.units') },
    { id: 'providers', label: t('form.tabs.providers') },
  ];

  const validateProviderAssignment = (providerId: string, index: number) => {
    if (!providerId) {
      return t('form.providerAssignments.providerRequired');
    }

    const duplicateIndex = form
      .getValues('providerAssignments')
      .findIndex(
        (assignment, assignmentIndex) =>
          assignmentIndex !== index && assignment.providerId === providerId
      );

    return duplicateIndex === -1 || t('form.providerAssignments.providerDuplicate');
  };

  type PricingInput = { marginPercent: number } | { marginAmount: number } | { price: number };

  const syncTier = (
    priceField: PricingField,
    percentField: MarginPercentField,
    amountField: MarginAmountField,
    pricingInput: PricingInput
  ) => {
    const result = calculatePricing({ cost: form.getValues('cost'), ...pricingInput });
    form.setValue(priceField, result.price, { shouldDirty: true, shouldValidate: true });
    form.setValue(percentField, result.marginPercent, { shouldDirty: true, shouldValidate: true });
    form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
  };

  const syncAllTiersFromCost = (cost: number) => {
    form.setValue('cost', cost, { shouldDirty: true, shouldValidate: true });

    const tiers: Array<[PricingField, MarginPercentField, MarginAmountField]> = [
      ['price', 'marginPercent1', 'marginAmount1'],
      ['price2', 'marginPercent2', 'marginAmount2'],
      ['price3', 'marginPercent3', 'marginAmount3'],
    ];

    for (const [priceField, percentField, amountField] of tiers) {
      const result = calculatePricing({
        cost,
        marginPercent: form.getValues(percentField),
      });

      form.setValue(priceField, result.price, { shouldDirty: true, shouldValidate: true });
      form.setValue(percentField, result.marginPercent, { shouldDirty: true, shouldValidate: true });
      form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
    }
  };

  const costField = form.register('cost', { min: 0, valueAsNumber: true });
  const initialCostField = form.register('initialCost', { min: 0, valueAsNumber: true });
  const taxRateField = form.register('taxRate', { min: 0, max: 100, valueAsNumber: true });
  const stockField = form.register('stock', { min: 0, valueAsNumber: true });
  const minStockField = form.register('minStock', { min: 0, valueAsNumber: true });
  const fractionStepField = form.register('fractionStep', { min: 0.01, valueAsNumber: true });
  const fractionMinimumField = form.register('fractionMinimum', { min: 0.01, valueAsNumber: true });
  const sellByFractionField = form.register('sellByFraction');
  const vatRateField = form.register('vatRateId');
  const sellByFraction = useWatch({
    control: form.control,
    name: 'sellByFraction',
  });
  const isActive = useWatch({
    control: form.control,
    name: 'isActive',
  });
  const { errors } = form.formState;

  const handleBaseUnitChange = (index: number) => {
    const assignments = form.getValues('unitAssignments');
    assignments.forEach((_, assignmentIndex) => {
      form.setValue(`unitAssignments.${assignmentIndex}.isBase`, assignmentIndex === index, {
        shouldDirty: true,
        shouldValidate: true,
      });
    });
    form.setValue(`unitAssignments.${index}.equivalence`, 1, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  // -------- ENG-078: AI category suggestion ----------------------------------
  // Gate: only fires when the semantic-search module is active AND the caller
  // has manager+ role. Cashiers never reach this modal but we still defend.
  const auth = useAuth();
  const semanticSearchActive = useIsModuleActive('semantic-search');
  const suggestionsEnabled =
    semanticSearchActive &&
    (auth.user?.role === 'admin' || auth.user?.role === 'manager');

  const [suggestion, setSuggestion] = useState<{
    categoryId: string;
    confidence: number;
  } | null>(null);
  const [autoPreselectedCategoryId, setAutoPreselectedCategoryId] = useState<string | null>(null);
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string | null>(null);

  const watchedName = useWatch({ control: form.control, name: 'name' });
  const watchedDescription = useWatch({ control: form.control, name: 'description' });
  const watchedCategoryId = useWatch({ control: form.control, name: 'categoryId' });

  const suggestCategoryMutation = trpc.products.suggestCategory.useMutation({
    // The auto-preselect path lives in the mutation handler (event-driven)
    // rather than a follow-up useEffect so React Compiler's
    // set-state-in-effect rule stays happy — we react to a server response,
    // not to a React state diff.
    onSuccess: (result, variables) => {
      if (
        !matchesCurrentSuggestionInputs(variables, {
          name: form.getValues('name'),
          description: form.getValues('description'),
        })
      ) {
        return;
      }
      if (!result.ok) {
        setSuggestion(null);
        return;
      }
      setSuggestion(result.suggestion);
      if (
        result.suggestion.confidence >= HIGH_CONFIDENCE &&
        mode === 'create' &&
        form.getValues('categoryId') === ''
      ) {
        form.setValue('categoryId', result.suggestion.categoryId, { shouldDirty: true });
        setAutoPreselectedCategoryId(result.suggestion.categoryId);
      }
    },
    onError: (_error, variables) => {
      if (
        !matchesCurrentSuggestionInputs(variables, {
          name: form.getValues('name'),
          description: form.getValues('description'),
        })
      ) {
        return;
      }
      // Silent — this is a non-blocking assist. Toasting a network blip
      // would degrade UX more than the missing suggestion does.
      setSuggestion(null);
    },
  });

  // 800ms debounce on name + description, only when the gate is open and
  // the inputs have enough signal to be worth a server call. setState inside
  // the setTimeout callback satisfies the React Compiler rule (async, not
  // synchronous-in-effect).
  useEffect(() => {
    if (!suggestionsEnabled) return;
    if (!isOpen) return;
    const trimmedName = (watchedName ?? '').trim();
    if (trimmedName.length < 3) {
      return;
    }
    const handle = window.setTimeout(() => {
      const variables: SuggestCategoryInput = {
        name: trimmedName,
        description: normalizeSuggestionDescription(watchedDescription),
      };
      suggestCategoryMutation.mutate(variables);
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // suggestCategoryMutation reference is stable per tRPC's contract;
    // listing it would re-fire the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsEnabled, isOpen, watchedName, watchedDescription]);

  // Clear all suggestion state when the modal opens/closes or the product
  // identity changes — fresh modal = fresh suggestion state. The setState
  // calls live inside a deferred setTimeout(0) callback so the React
  // Compiler rule (no synchronous-setState in effects) stays satisfied.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSuggestion(null);
      setAutoPreselectedCategoryId(null);
      setDismissedSuggestionId(null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [isOpen, product?.id]);

  const suggestedCategory = useMemo(
    () => (suggestion ? categories.find(c => c.id === suggestion.categoryId) ?? null : null),
    [suggestion, categories]
  );

  // The badge holds only while the operator's current category matches the
  // category we auto-preselected. No setState plumbing — derived directly
  // from render-time state so changing the dropdown manually drops the
  // badge naturally and switching back to the same category restores it
  // (the AI did, after all, recommend that category).
  const showAutoSelectedBadge = Boolean(
    autoPreselectedCategoryId &&
      watchedCategoryId === autoPreselectedCategoryId &&
      dismissedSuggestionId !== autoPreselectedCategoryId
  );

  const showSuggestionChip = Boolean(
    suggestion &&
      suggestedCategory &&
      suggestion.confidence >= MEDIUM_CONFIDENCE_FLOOR &&
      dismissedSuggestionId !== suggestion.categoryId &&
      // Avoid double-affordance: when we already auto-preselected, the badge
      // handles the messaging.
      !showAutoSelectedBadge &&
      // No point chipping the category the form already holds (edit-mode
      // case where the saved value already matches).
      watchedCategoryId !== suggestion.categoryId
  );

  const handleApplySuggestion = () => {
    if (!suggestion) return;
    form.setValue('categoryId', suggestion.categoryId, { shouldDirty: true });
    setDismissedSuggestionId(suggestion.categoryId);
  };

  const handleDismissSuggestion = () => {
    if (!suggestion) return;
    setDismissedSuggestionId(suggestion.categoryId);
  };
  // -------- end ENG-078 ------------------------------------------------------

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
          <div
            id="product-tabpanel-general"
            role="tabpanel"
            aria-labelledby="product-tab-general"
            className="space-y-8"
          >
            {/* --- Identity --------------------------------------------------- */}
            <FieldGroup
              title={t('form.sections.identity.title')}
              description={t('form.sections.identity.description')}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <SimpleFormField
                  label={t('form.fields.name')}
                  htmlFor="product-name"
                  className={REQUIRED_LABEL}
                  {...errorProp(errors.name?.message)}
                >
                  <input
                    id="product-name"
                    aria-required="true"
                    className={cn('pv-input', errors.name && 'error')}
                    {...form.register('name', { required: t('form.fields.nameRequired') })}
                  />
                </SimpleFormField>
                <SimpleFormField
                  label={t('form.fields.sku')}
                  htmlFor="product-sku"
                  className={REQUIRED_LABEL}
                  helperText={t('form.fields.skuHelp')}
                  {...errorProp(errors.sku?.message)}
                >
                  <input
                    id="product-sku"
                    aria-required="true"
                    className={cn('pv-input', errors.sku && 'error')}
                    {...form.register('sku', { required: t('form.fields.skuRequired') })}
                  />
                </SimpleFormField>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SimpleFormField
                  label={t('form.fields.barcode')}
                  htmlFor="product-barcode"
                  className="self-start"
                >
                  <span className="pv-input">
                    <ScanLine aria-hidden="true" />
                    <input
                      id="product-barcode"
                      className="w-full border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-fg4"
                      placeholder={t('form.fields.barcodePlaceholder')}
                      {...form.register('barcode')}
                    />
                  </span>
                </SimpleFormField>
                <SimpleFormField label={t('form.fields.imageUrl')} htmlFor="product-image-url">
                  <input
                    id="product-image-url"
                    className="pv-input"
                    {...form.register('imageUrl')}
                  />
                </SimpleFormField>
              </div>

              <SimpleFormField label={t('form.fields.description')} htmlFor="product-description">
                <textarea
                  id="product-description"
                  className="pv-input area"
                  placeholder={t('form.fields.descriptionPlaceholder')}
                  {...form.register('description')}
                />
              </SimpleFormField>
            </FieldGroup>

            {/* --- Classification --------------------------------------------- */}
            <FieldGroup
              title={t('form.sections.classification.title')}
              description={t('form.sections.classification.description')}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="pv-field">
                  <label htmlFor="product-category" className="label flex items-center gap-2">
                    <span>{t('form.fields.category')}</span>
                    {showAutoSelectedBadge && (
                      <span
                        data-testid="suggest-category-badge"
                        className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-[0.65rem] font-medium normal-case tracking-normal text-success-700"
                      >
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {t('suggestCategory.autoSelectedBadge')}
                      </span>
                    )}
                  </label>
                  <select id="product-category" className="pv-input" {...form.register('categoryId')}>
                    <option value="">{t('form.fields.noCategory')}</option>
                    {categories.map(category => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  {showSuggestionChip && suggestion && suggestedCategory && (
                    <div
                      data-testid="suggest-category-chip"
                      className="mt-1 inline-flex items-center gap-2 self-start rounded-full bg-primary-50 px-3 py-1 text-xs text-primary-700"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {t('suggestCategory.chipPrefix')}:{' '}
                        {t('suggestCategory.chipLabel', {
                          name: suggestedCategory.name,
                          percent: Math.round(suggestion.confidence * 100),
                        })}
                      </span>
                      <button
                        type="button"
                        data-testid="suggest-category-apply"
                        className="ml-1 rounded-full bg-primary-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-700"
                        onClick={handleApplySuggestion}
                      >
                        {t('suggestCategory.chipApplyCta')}
                      </button>
                      <button
                        type="button"
                        data-testid="suggest-category-dismiss"
                        aria-label={t('suggestCategory.chipDismissAria')}
                        className="rounded-full p-0.5 text-primary-700 hover:bg-primary-100"
                        onClick={handleDismissSuggestion}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
                <SimpleFormField label={t('form.fields.provider')} htmlFor="product-provider">
                  <select id="product-provider" className="pv-input" {...form.register('providerId')}>
                    <option value="">{t('form.fields.noProvider')}</option>
                    {providers.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </SimpleFormField>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <SimpleFormField label={t('form.fields.vatRate')} htmlFor="product-vat-rate">
                  <select
                    id="product-vat-rate"
                    className="pv-input"
                    {...vatRateField}
                    onChange={event => {
                      vatRateField.onChange(event);
                      const selected = vatRates.find(vatRate => vatRate.id === event.target.value);
                      form.setValue('taxRate', selected?.rate ?? 0, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  >
                    <option value="">{t('form.fields.manualTaxRate')}</option>
                    {vatRates.map(vatRate => (
                      <option key={vatRate.id} value={vatRate.id}>
                        {vatRate.name} ({vatRate.rate}%)
                      </option>
                    ))}
                  </select>
                </SimpleFormField>
                <SimpleFormField
                  label={t('form.fields.taxRate')}
                  htmlFor="product-tax-rate"
                  {...errorProp(errors.taxRate?.message)}
                >
                  <input
                    id="product-tax-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    className={cn('pv-input', errors.taxRate && 'error')}
                    disabled={!!selectedVatRateId}
                    {...taxRateField}
                  />
                </SimpleFormField>
                <SimpleFormField label={t('form.fields.location')} htmlFor="product-location">
                  <select id="product-location" className="pv-input" {...form.register('locationId')}>
                    <option value="">{t('form.fields.noLocation')}</option>
                    {locations.map(location => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </SimpleFormField>
              </div>
            </FieldGroup>

            {/* --- Inventory -------------------------------------------------- */}
            <FieldGroup
              title={t('form.sections.inventory.title')}
              description={t('form.sections.inventory.description')}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <SimpleFormField
                  label={t('form.fields.stock')}
                  htmlFor="product-stock"
                  {...errorProp(errors.stock?.message)}
                >
                  <input
                    id="product-stock"
                    type="number"
                    min="0"
                    step="any"
                    className={cn('pv-input', errors.stock && 'error')}
                    {...stockField}
                  />
                </SimpleFormField>
                <SimpleFormField
                  label={t('form.fields.minStock')}
                  htmlFor="product-min-stock"
                  helperText={t('form.fields.minStockHelp')}
                  {...errorProp(errors.minStock?.message)}
                >
                  <input
                    id="product-min-stock"
                    type="number"
                    min="0"
                    step="any"
                    className={cn('pv-input', errors.minStock && 'error')}
                    {...minStockField}
                  />
                </SimpleFormField>
              </div>

              <div className="rounded-2xl border border-line/80 bg-surface-2/50 p-4">
                <label className="flex items-center gap-3 text-sm font-medium text-secondary-900">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-secondary-300"
                    {...sellByFractionField}
                    onChange={event => {
                      sellByFractionField.onChange(event);

                      if (event.target.checked) {
                        const nextFractionStep = Math.max(0.01, form.getValues('fractionStep') || 0.01);
                        const nextFractionMinimum = Math.max(
                          form.getValues('fractionMinimum') || 0.01,
                          nextFractionStep
                        );

                        form.setValue('fractionStep', nextFractionStep, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                        form.setValue('fractionMinimum', nextFractionMinimum, {
                          shouldDirty: true,
                          shouldValidate: true,
                        });
                      }
                    }}
                  />
                  {t('form.fields.sellByFraction')}
                </label>
                <p className="mt-2 text-sm text-secondary-500">{t('form.fields.sellByFractionHelp')}</p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <SimpleFormField label={t('form.fields.fractionStep')} htmlFor="product-fraction-step">
                    <input
                      id="product-fraction-step"
                      type="number"
                      min="0.01"
                      step="any"
                      disabled={!sellByFraction}
                      className="pv-input"
                      {...fractionStepField}
                    />
                  </SimpleFormField>
                  <SimpleFormField
                    label={t('form.fields.fractionMinimum')}
                    htmlFor="product-fraction-minimum"
                  >
                    <input
                      id="product-fraction-minimum"
                      type="number"
                      min="0.01"
                      step="any"
                      disabled={!sellByFraction}
                      className="pv-input"
                      {...fractionMinimumField}
                    />
                  </SimpleFormField>
                </div>
              </div>
            </FieldGroup>
          </div>
        )}

        {activeTab === 'pricing' && (
          <div id="product-tabpanel-pricing" role="tabpanel" aria-labelledby="product-tab-pricing">
            <PricingSection
              form={form}
              costField={costField}
              initialCostField={initialCostField}
              syncAllTiersFromCost={syncAllTiersFromCost}
              syncTier={syncTier}
            />
          </div>
        )}

        {activeTab === 'units' && (
          <div id="product-tabpanel-units" role="tabpanel" aria-labelledby="product-tab-units">
            <UnitAssignmentsSection
              form={form}
              units={units}
              unitAssignmentsFieldArray={unitAssignmentsFieldArray}
              onBaseUnitChange={handleBaseUnitChange}
            />
          </div>
        )}

        {activeTab === 'providers' && (
          <div
            id="product-tabpanel-providers"
            role="tabpanel"
            aria-labelledby="product-tab-providers"
          >
            <ProviderAssignmentsSection
              form={form}
              providers={providers}
              providerAssignmentsFieldArray={providerAssignmentsFieldArray}
              validateProviderAssignment={validateProviderAssignment}
            />
          </div>
        )}

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

interface PricingTierSectionProps {
  title: string;
  priceField: UseFormRegisterReturn<PricingField>;
  percentField: UseFormRegisterReturn<MarginPercentField>;
  amountField: UseFormRegisterReturn<MarginAmountField>;
  onPriceChange: (value: number) => void;
  onPercentChange: (value: number) => void;
  onAmountChange: (value: number) => void;
}

interface PricingSectionProps {
  form: UseFormReturn<ProductFormValues>;
  costField: UseFormRegisterReturn<'cost'>;
  initialCostField: UseFormRegisterReturn<'initialCost'>;
  syncAllTiersFromCost: (cost: number) => void;
  syncTier: (
    priceField: PricingField,
    percentField: MarginPercentField,
    amountField: MarginAmountField,
    pricingInput: { marginPercent: number } | { marginAmount: number } | { price: number }
  ) => void;
}

function PricingSection({
  form,
  costField,
  initialCostField,
  syncAllTiersFromCost,
  syncTier,
}: PricingSectionProps) {
  const { t } = useTranslation('products');
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="pv-field">
          <label htmlFor="product-cost" className="label">
            {t('form.fields.cost')}
          </label>
          <input
            id="product-cost"
            type="number"
            step="0.01"
            min="0"
            className="pv-input"
            {...costField}
            onChange={event => {
              costField.onChange(event);
              syncAllTiersFromCost(parseNumber(event.target.value));
            }}
          />
        </div>
        <div className="pv-field">
          <label htmlFor="product-initial-cost" className="label">
            {t('form.fields.initialCost')}
          </label>
          <input
            id="product-initial-cost"
            type="number"
            step="0.01"
            min="0"
            className="pv-input"
            {...initialCostField}
          />
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-secondary-200 p-4">
        <PricingTierSection
          title={t('form.fields.priceTier1')}
          priceField={form.register('price', { min: 0, valueAsNumber: true })}
          percentField={form.register('marginPercent1', { min: 0, valueAsNumber: true })}
          amountField={form.register('marginAmount1', { min: 0, valueAsNumber: true })}
          onPriceChange={value => syncTier('price', 'marginPercent1', 'marginAmount1', { price: value })}
          onPercentChange={value =>
            syncTier('price', 'marginPercent1', 'marginAmount1', { marginPercent: value })
          }
          onAmountChange={value =>
            syncTier('price', 'marginPercent1', 'marginAmount1', { marginAmount: value })
          }
        />
        <PricingTierSection
          title={t('form.fields.priceTier2')}
          priceField={form.register('price2', { min: 0, valueAsNumber: true })}
          percentField={form.register('marginPercent2', { min: 0, valueAsNumber: true })}
          amountField={form.register('marginAmount2', { min: 0, valueAsNumber: true })}
          onPriceChange={value => syncTier('price2', 'marginPercent2', 'marginAmount2', { price: value })}
          onPercentChange={value =>
            syncTier('price2', 'marginPercent2', 'marginAmount2', { marginPercent: value })
          }
          onAmountChange={value =>
            syncTier('price2', 'marginPercent2', 'marginAmount2', { marginAmount: value })
          }
        />
        <PricingTierSection
          title={t('form.fields.priceTier3')}
          priceField={form.register('price3', { min: 0, valueAsNumber: true })}
          percentField={form.register('marginPercent3', { min: 0, valueAsNumber: true })}
          amountField={form.register('marginAmount3', { min: 0, valueAsNumber: true })}
          onPriceChange={value => syncTier('price3', 'marginPercent3', 'marginAmount3', { price: value })}
          onPercentChange={value =>
            syncTier('price3', 'marginPercent3', 'marginAmount3', { marginPercent: value })
          }
          onAmountChange={value =>
            syncTier('price3', 'marginPercent3', 'marginAmount3', { marginAmount: value })
          }
        />
      </div>
    </>
  );
}

interface UnitAssignmentsSectionProps {
  form: UseFormReturn<ProductFormValues>;
  units: LookupOption[];
  unitAssignmentsFieldArray: UseFieldArrayReturn<ProductFormValues, 'unitAssignments', 'id'>;
  onBaseUnitChange: (index: number) => void;
}

function UnitAssignmentsSection({
  form,
  units,
  unitAssignmentsFieldArray,
  onBaseUnitChange,
}: UnitAssignmentsSectionProps) {
  const { t } = useTranslation('products');
  const unitAssignments = useWatch({
    control: form.control,
    name: 'unitAssignments',
  });

  return (
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
  );
}

interface ProviderAssignmentsSectionProps {
  form: UseFormReturn<ProductFormValues>;
  providers: LookupOption[];
  providerAssignmentsFieldArray: UseFieldArrayReturn<ProductFormValues, 'providerAssignments', 'id'>;
  validateProviderAssignment: (providerId: string, index: number) => string | true;
}

function ProviderAssignmentsSection({
  form,
  providers,
  providerAssignmentsFieldArray,
  validateProviderAssignment,
}: ProviderAssignmentsSectionProps) {
  const { t } = useTranslation('products');
  return (
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
  );
}

function PricingTierSection({
  title,
  priceField,
  percentField,
  amountField,
  onPriceChange,
  onPercentChange,
  onAmountChange,
}: PricingTierSectionProps) {
  const { t } = useTranslation('products');
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-3">
        <p className="text-sm font-medium text-secondary-900">{title}</p>
      </div>
      <div className="pv-field">
        <label className="label">{t('form.fields.marginPercent')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="pv-input"
          {...percentField}
          onChange={event => {
            percentField.onChange(event);
            onPercentChange(parseNumber(event.target.value));
          }}
        />
      </div>
      <div className="pv-field">
        <label className="label">{t('form.fields.marginAmount')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="pv-input"
          {...amountField}
          onChange={event => {
            amountField.onChange(event);
            onAmountChange(parseNumber(event.target.value));
          }}
        />
      </div>
      <div className="pv-field">
        <label className="label">{t('form.fields.salePrice')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="pv-input"
          {...priceField}
          onChange={event => {
            priceField.onChange(event);
            onPriceChange(parseNumber(event.target.value));
          }}
        />
      </div>
    </div>
  );
}
