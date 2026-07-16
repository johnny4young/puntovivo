import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFieldArrayReturn,
  type UseFormReturn,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Product } from '@/types';
import { calculatePricing } from './pricing';
import { mapProductToForm } from './productForm.helpers';
import type {
  MarginAmountField,
  MarginPercentField,
  PricingField,
  ProductFormValues,
  ProductRole,
} from './productForm.types';

type PricingInput = { marginPercent: number } | { marginAmount: number } | { price: number };

/**
 * Inputs the form logic needs. Mirrors the subset of ProductFormModalProps
 * that drives react-hook-form: the mode + product seed the defaults, the
 * optional defaultName pre-fills create mode, and onSubmit / onCreated wire
 * the submit pipeline (ENG-105c).
 */
export interface UseProductFormArgs {
  mode: ProductRole;
  product: Product | null;
  // ENG-179b — explicit `| undefined` on optional fields.
  defaultName?: string | undefined;
  onSubmit: (values: ProductFormValues) => Promise<Product | void>;
  onCreated?: ((product: Product) => void) | undefined;
}

/**
 * Owns the react-hook-form wiring for the product form: the `useForm`
 * instance (with the ENG-105c create-mode `defaultName` prefill), the
 * ENG-105c `handleSubmit` wrapper that fires `onCreated` on create, the two
 * `useFieldArray` controllers, every pre-built `form.register(...)` field
 * config, the price/margin sync helpers, the base-unit + provider-duplicate
 * logic, and the render-time `useWatch` values the tabs/footer read. The
 * returned object is a single bundle threaded by prop into the tab
 * components — no context/provider.
 */
export interface UseProductFormReturn {
  form: UseFormReturn<ProductFormValues>;
  errors: UseFormReturn<ProductFormValues>['formState']['errors'];
  handleSubmit: ReturnType<UseFormReturn<ProductFormValues>['handleSubmit']>;
  unitAssignmentsFieldArray: UseFieldArrayReturn<ProductFormValues, 'unitAssignments', 'id'>;
  providerAssignmentsFieldArray: UseFieldArrayReturn<
    ProductFormValues,
    'providerAssignments',
    'id'
  >;
  costField: UseFormRegisterReturn<'cost'>;
  initialCostField: UseFormRegisterReturn<'initialCost'>;
  taxRateField: UseFormRegisterReturn<'taxRate'>;
  stockField: UseFormRegisterReturn<'stock'>;
  minStockField: UseFormRegisterReturn<'minStock'>;
  fractionStepField: UseFormRegisterReturn<'fractionStep'>;
  fractionMinimumField: UseFormRegisterReturn<'fractionMinimum'>;
  sellByFractionField: UseFormRegisterReturn<'sellByFraction'>;
  tracksLotsField: UseFormRegisterReturn<'tracksLots'>;
  tracksSerialsField: UseFormRegisterReturn<'tracksSerials'>;
  vatRateField: UseFormRegisterReturn<'vatRateId'>;
  syncTier: (
    priceField: PricingField,
    percentField: MarginPercentField,
    amountField: MarginAmountField,
    pricingInput: PricingInput
  ) => void;
  syncAllTiersFromCost: (cost: number) => void;
  handleBaseUnitChange: (index: number) => void;
  validateProviderAssignment: (providerId: string, index: number) => string | true;
  selectedVatRateId: string;
  sellByFraction: boolean;
  tracksLots: boolean;
  tracksSerials: boolean;
  isActive: boolean;
}

export function useProductForm({
  mode,
  product,
  defaultName,
  onSubmit,
  onCreated,
}: UseProductFormArgs): UseProductFormReturn {
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
      form.setValue(percentField, result.marginPercent, {
        shouldDirty: true,
        shouldValidate: true,
      });
      form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
    }
  };

  const costField = form.register('cost', { min: 0, valueAsNumber: true });
  const initialCostField = form.register('initialCost', { min: 0, valueAsNumber: true });
  const taxRateField = form.register('taxRate', { min: 0, max: 100, valueAsNumber: true });
  const stockField = form.register('stock', {
    min: 0,
    valueAsNumber: true,
    validate: value => {
      const tracksLots = form.getValues('tracksLots');
      const tracksSerials = form.getValues('tracksSerials');
      if (!tracksLots && !tracksSerials) return true;
      if (
        (product?.tracksLots === true || product?.tracksSerials === true) &&
        value === product.stock
      ) {
        return true;
      }
      if (value === 0) return true;
      return tracksSerials
        ? t('form.fields.trackedStockError')
        : t('form.fields.tracksLotsStockError');
    },
  });
  const minStockField = form.register('minStock', { min: 0, valueAsNumber: true });
  const fractionStepField = form.register('fractionStep', { min: 0.01, valueAsNumber: true });
  const fractionMinimumField = form.register('fractionMinimum', { min: 0.01, valueAsNumber: true });
  const sellByFractionField = form.register('sellByFraction');
  const tracksLotsField = form.register('tracksLots');
  const tracksSerialsField = form.register('tracksSerials');
  const vatRateField = form.register('vatRateId');
  const sellByFraction = useWatch({
    control: form.control,
    name: 'sellByFraction',
  });
  const tracksLots = useWatch({
    control: form.control,
    name: 'tracksLots',
  });
  const tracksSerials = useWatch({
    control: form.control,
    name: 'tracksSerials',
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

  return {
    form,
    errors,
    handleSubmit,
    unitAssignmentsFieldArray,
    providerAssignmentsFieldArray,
    costField,
    initialCostField,
    taxRateField,
    stockField,
    minStockField,
    fractionStepField,
    fractionMinimumField,
    sellByFractionField,
    tracksLotsField,
    tracksSerialsField,
    vatRateField,
    syncTier,
    syncAllTiersFromCost,
    handleBaseUnitChange,
    validateProviderAssignment,
    selectedVatRateId,
    sellByFraction,
    tracksLots,
    tracksSerials,
    isActive,
  };
}
