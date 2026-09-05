import { useCallback, useEffect, useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { formatQuantity } from '@puntovivo/shared/unit-math';
import { Edit3, Eye, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { TablePagination } from '@/components/tables/TablePagination';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Product } from '@/types';
import { ExactLotAllocationEditor } from './LotEditors';
import {
  haveSameExactLotOptions,
  isLotExpiredAt,
  normalizeExactLotAllocations,
  formatLotExpiryDate,
  parsePositiveQuantity,
  quantitiesMatch,
  sumExactLotAllocations,
  type ExactLotAllocationDraft,
  type ExactLotOption,
} from './lotForm';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type TransformationRecipe =
  RouterOutputs['inventoryTransformations']['listRecipes']['items'][number];
type TransformationHistory = RouterOutputs['inventoryTransformations']['list']['items'][number];
type TransformationDetails = RouterOutputs['inventoryTransformations']['getById'];

type RecipeKind = 'assembly' | 'disassembly' | 'cut' | 'recipe';
type OutputRole = 'primary' | 'byproduct' | 'remnant';

interface RecipeInputDraft {
  key: string;
  productId: string;
  baseQuantity: string;
}

interface RecipeOutputDraft {
  key: string;
  productId: string;
  baseQuantity: string;
  allocationWeight: string;
  role: OutputRole;
}

type RecipeProductOption = Pick<Product, 'id' | 'name' | 'sku'>;

interface ExecutionInputDraft {
  baseQuantity: string;
  allocations: ExactLotAllocationDraft;
  wasteQuantity: string;
  wasteAllocations: ExactLotAllocationDraft;
  wasteReason: string;
}

interface ExecutionOutputDraft {
  baseQuantity: string;
  allocationWeight: string;
  lotNumber: string;
  expiresAt: string;
}

let localLineSequence = 0;
function lineKey(prefix: string) {
  localLineSequence += 1;
  return `${prefix}-${localLineSequence}`;
}

function newInput(): RecipeInputDraft {
  return { key: lineKey('input'), productId: '', baseQuantity: '1' };
}

function newOutput(): RecipeOutputDraft {
  return {
    key: lineKey('output'),
    productId: '',
    baseQuantity: '1',
    allocationWeight: '1',
    role: 'primary',
  };
}

interface RecipeModalProps {
  recipe: TransformationRecipe | null;
  siteId: string;
  products: Product[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: {
    id?: string;
    version?: number;
    siteId: string | null;
    name: string;
    kind: RecipeKind;
    notes: string | null;
    isActive: boolean;
    inputs: Array<{ productId: string; baseQuantity: number }>;
    outputs: Array<{
      productId: string;
      expectedBaseQuantity: number;
      allocationWeight: number;
      role: OutputRole;
    }>;
  }) => Promise<void>;
}

function RecipeModal({
  recipe,
  siteId,
  products,
  saving,
  error,
  onClose,
  onSubmit,
}: RecipeModalProps) {
  const { t } = useTranslation('inventory');
  const [name, setName] = useState(recipe?.name ?? '');
  const [kind, setKind] = useState<RecipeKind>(recipe?.kind ?? 'assembly');
  const [notes, setNotes] = useState(recipe?.notes ?? '');
  const [isActive, setIsActive] = useState(recipe?.isActive ?? true);
  const [availableAllSites, setAvailableAllSites] = useState(recipe?.siteId === null);
  const [inputs, setInputs] = useState<RecipeInputDraft[]>(() =>
    recipe
      ? recipe.inputs.map(input => ({
          key: lineKey('input'),
          productId: input.productId,
          baseQuantity: String(input.baseQuantity),
        }))
      : [newInput()]
  );
  const [outputs, setOutputs] = useState<RecipeOutputDraft[]>(() =>
    recipe
      ? recipe.outputs.map(output => ({
          key: lineKey('output'),
          productId: output.productId,
          baseQuantity: String(output.expectedBaseQuantity),
          allocationWeight: String(output.allocationWeight),
          role: output.role,
        }))
      : [newOutput()]
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [productSearchText, setProductSearchText] = useState('');
  const debouncedProductSearch = useDebouncedValue(productSearchText.trim(), 200);
  const productSearchQuery = trpc.products.search.useQuery(
    {
      q: debouncedProductSearch || '_',
      limit: 25,
      isActive: true,
      tracksStock: true,
    },
    { enabled: debouncedProductSearch.length > 0 }
  );
  const eligibleSearchProducts = useMemo(
    () =>
      ((productSearchQuery.data?.items ?? []) as Product[]).filter(
        product =>
          product.tracksStock && !product.tracksSerials && product.catalogType !== 'variant_parent'
      ),
    [productSearchQuery.data]
  );
  const [selectedProductOptions, setSelectedProductOptions] = useState<RecipeProductOption[]>(
    () => [
      ...(recipe?.inputs.map(input => ({
        id: input.productId,
        name: input.productName,
        sku: input.productSku,
      })) ?? []),
      ...(recipe?.outputs.map(output => ({
        id: output.productId,
        name: output.productName,
        sku: output.productSku,
      })) ?? []),
    ]
  );

  const productOptions = useMemo(() => {
    const byId = new Map<string, RecipeProductOption>();
    for (const product of [...products, ...selectedProductOptions, ...eligibleSearchProducts]) {
      byId.set(product.id, { id: product.id, name: product.name, sku: product.sku });
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [eligibleSearchProducts, products, selectedProductOptions]);

  function rememberProduct(productId: string) {
    const product = productOptions.find(option => option.id === productId);
    if (!product) return;
    setSelectedProductOptions(current =>
      current.some(option => option.id === product.id) ? current : [...current, product]
    );
  }

  function updateInput(key: string, changes: Partial<RecipeInputDraft>) {
    if (changes.productId) rememberProduct(changes.productId);
    setInputs(current => current.map(line => (line.key === key ? { ...line, ...changes } : line)));
  }

  function updateOutput(key: string, changes: Partial<RecipeOutputDraft>) {
    if (changes.productId) rememberProduct(changes.productId);
    setOutputs(current => current.map(line => (line.key === key ? { ...line, ...changes } : line)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const normalizedInputs = inputs.map(line => ({
      productId: line.productId,
      baseQuantity: parsePositiveQuantity(line.baseQuantity),
    }));
    const normalizedOutputs = outputs.map(line => ({
      productId: line.productId,
      expectedBaseQuantity: parsePositiveQuantity(line.baseQuantity),
      allocationWeight: parsePositiveQuantity(line.allocationWeight),
      role: line.role,
    }));
    const inputIds = normalizedInputs.map(line => line.productId);
    const outputIds = normalizedOutputs.map(line => line.productId);
    if (
      !name.trim() ||
      normalizedInputs.some(line => !line.productId || line.baseQuantity <= 0) ||
      normalizedOutputs.some(
        line => !line.productId || line.expectedBaseQuantity <= 0 || line.allocationWeight <= 0
      ) ||
      new Set(inputIds).size !== inputIds.length ||
      new Set(outputIds).size !== outputIds.length
    ) {
      setFormError(t('transformations.recipe.invalid'));
      return;
    }
    try {
      await onSubmit({
        ...(recipe ? { id: recipe.id, version: recipe.version } : {}),
        siteId: availableAllSites ? null : siteId,
        name: name.trim(),
        kind,
        notes: notes.trim() || null,
        isActive,
        inputs: normalizedInputs,
        outputs: normalizedOutputs,
      });
    } catch {
      // The mutation keeps the modal open and owns the localized error surface.
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        recipe ? t('transformations.recipe.editTitle') : t('transformations.recipe.createTitle')
      }
      size="full"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>
            {t('transformations.actions.cancel')}
          </button>
          <button
            type="submit"
            form="inventory-transformation-recipe-form"
            className="btn-primary"
            disabled={saving}
          >
            {saving ? t('transformations.actions.saving') : t('transformations.actions.save')}
          </button>
        </div>
      }
    >
      <form id="inventory-transformation-recipe-form" className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">{t('transformations.recipe.name')}</span>
            <input
              className="input mt-1"
              value={name}
              maxLength={120}
              onChange={event => setName(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">{t('transformations.recipe.kind')}</span>
            <select
              className="input mt-1"
              value={kind}
              onChange={event => setKind(event.target.value as RecipeKind)}
            >
              {(['assembly', 'disassembly', 'cut', 'recipe'] as const).map(option => (
                <option key={option} value={option}>
                  {t(`transformations.kinds.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label">{t('transformations.recipe.notes')}</span>
          <textarea
            className="input mt-1"
            rows={2}
            maxLength={1000}
            value={notes ?? ''}
            onChange={event => setNotes(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={event => setIsActive(event.target.checked)}
            />
            {t('transformations.recipe.active')}
          </label>
          <label className="flex items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={availableAllSites}
              onChange={event => setAvailableAllSites(event.target.checked)}
            />
            {t('transformations.recipe.allSites')}
          </label>
        </div>

        <div className="rounded-xl border border-secondary-200 p-4">
          <label className="block">
            <span className="label">{t('transformations.recipe.productSearch')}</span>
            <input
              type="search"
              className="input mt-1"
              value={productSearchText}
              onChange={event => setProductSearchText(event.target.value)}
            />
          </label>
          <p className="mt-1 text-xs text-secondary-500">
            {t('transformations.recipe.productSearchHelp')}
          </p>
          {productSearchQuery.isLoading && (
            <p className="mt-2 text-sm text-secondary-500">
              {t('transformations.recipe.productSearchLoading')}
            </p>
          )}
          {productSearchQuery.error && (
            <p className="mt-2 text-sm text-danger-700" role="alert">
              {t('transformations.recipe.productSearchError')}
            </p>
          )}
          {debouncedProductSearch.length > 0 &&
            !productSearchQuery.isLoading &&
            !productSearchQuery.error && (
              <p className="mt-2 text-sm text-secondary-600" aria-live="polite">
                {eligibleSearchProducts.length > 0
                  ? t('transformations.recipe.productSearchResultCount', {
                      count: eligibleSearchProducts.length,
                    })
                  : t('transformations.recipe.productSearchNoEligible')}
              </p>
            )}
        </div>

        <RecipeLinesEditor
          title={t('transformations.recipe.inputs')}
          lines={inputs}
          onAdd={() => setInputs(current => [...current, newInput()])}
          onRemove={key => setInputs(current => current.filter(line => line.key !== key))}
          renderLine={line => (
            <>
              <ProductSelect
                products={productOptions}
                value={line.productId}
                onChange={productId => updateInput(line.key, { productId })}
              />
              <QuantityInput
                label={t('transformations.recipe.baseQuantity')}
                value={line.baseQuantity}
                onChange={baseQuantity => updateInput(line.key, { baseQuantity })}
              />
            </>
          )}
        />

        <RecipeLinesEditor
          title={t('transformations.recipe.outputs')}
          lines={outputs}
          onAdd={() => setOutputs(current => [...current, newOutput()])}
          onRemove={key => setOutputs(current => current.filter(line => line.key !== key))}
          renderLine={line => (
            <>
              <ProductSelect
                products={productOptions}
                value={line.productId}
                onChange={productId => updateOutput(line.key, { productId })}
              />
              <QuantityInput
                label={t('transformations.recipe.baseQuantity')}
                value={line.baseQuantity}
                onChange={baseQuantity => updateOutput(line.key, { baseQuantity })}
              />
              <QuantityInput
                label={t('transformations.recipe.weight')}
                value={line.allocationWeight}
                onChange={allocationWeight => updateOutput(line.key, { allocationWeight })}
              />
              <label className="block">
                <span className="label">{t('transformations.recipe.role')}</span>
                <select
                  className="input mt-1"
                  value={line.role}
                  onChange={event =>
                    updateOutput(line.key, { role: event.target.value as OutputRole })
                  }
                >
                  {(['primary', 'byproduct', 'remnant'] as const).map(role => (
                    <option key={role} value={role}>
                      {t(`transformations.roles.${role}`)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        />

        {(formError || error) && (
          <p className="text-sm text-danger-700" role="alert">
            {formError ?? error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function ProductSelect({
  products,
  value,
  onChange,
}: {
  products: RecipeProductOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('inventory');
  return (
    <label className="block min-w-56 flex-1">
      <span className="label">{t('transformations.recipe.product')}</span>
      <select className="input mt-1" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{t('transformations.recipe.selectProduct')}</option>
        {products.map(product => (
          <option key={product.id} value={product.id}>
            {product.name} · {product.sku}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuantityInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-32">
      <span className="label">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        className="input mt-1"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  );
}

function RecipeLinesEditor<T extends { key: string }>({
  title,
  lines,
  onAdd,
  onRemove,
  renderLine,
}: {
  title: string;
  lines: T[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  renderLine: (line: T) => React.ReactNode;
}) {
  const { t } = useTranslation('inventory');
  return (
    <fieldset className="rounded-xl border border-secondary-200 p-4">
      <legend className="px-1 font-medium text-secondary-900">{title}</legend>
      <div className="space-y-3">
        {lines.map(line => (
          <div
            key={line.key}
            className="flex flex-wrap items-end gap-3 rounded-lg bg-secondary-50 p-3"
          >
            {renderLine(line)}
            <button
              type="button"
              className="btn-ghost p-2"
              aria-label={t('transformations.recipe.removeLine')}
              disabled={lines.length === 1}
              onClick={() => onRemove(line.key)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn-secondary mt-3 inline-flex items-center gap-2"
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('transformations.recipe.addLine')}
      </button>
    </fieldset>
  );
}

function TransformationInputEditor({
  siteId,
  input,
  value,
  disabled,
  onChange,
  onOptionsChange,
}: {
  siteId: string;
  input: TransformationRecipe['inputs'][number];
  value: ExecutionInputDraft;
  disabled: boolean;
  onChange: (value: ExecutionInputDraft) => void;
  onOptionsChange: (recipeInputId: string, options: ExactLotOption[]) => void;
}) {
  const { t } = useTranslation('inventory');
  const [now] = useState(() => Date.now());
  const lotsQuery = trpc.inventoryLots.list.useQuery(
    { siteId, productId: input.productId, activeOnly: true },
    { enabled: input.tracksLots }
  );
  const options: ExactLotOption[] = useMemo(
    () =>
      (lotsQuery.data?.items ?? [])
        .filter(lot => lot.onHand > 0 && !isLotExpiredAt(lot.expiresAt, now))
        .map(lot => ({
          id: lot.id,
          lotNumber: lot.lotNumber,
          expiresAt: lot.expiresAt,
          status: lot.status,
          availableQuantity: lot.onHand,
        })),
    [lotsQuery.data, now]
  );
  const allocatedLotIds = useMemo(
    () => options.filter(option => parsePositiveQuantity(value.allocations[option.id] ?? '') > 0),
    [options, value.allocations]
  );
  const wasteOptions = useMemo(
    () =>
      allocatedLotIds.map(option => ({
        ...option,
        availableQuantity: parsePositiveQuantity(value.allocations[option.id] ?? ''),
      })),
    [allocatedLotIds, value.allocations]
  );

  useEffect(() => {
    onOptionsChange(input.id, options);
  }, [input.id, onOptionsChange, options]);

  useEffect(() => {
    if (!input.tracksLots) return;
    const availableIds = new Set(wasteOptions.map(option => option.id));
    const nextWasteAllocations = Object.fromEntries(
      Object.entries(value.wasteAllocations).filter(([lotId]) => availableIds.has(lotId))
    );
    if (Object.keys(nextWasteAllocations).length !== Object.keys(value.wasteAllocations).length) {
      onChange({ ...value, wasteAllocations: nextWasteAllocations });
    }
  }, [input.tracksLots, onChange, value, wasteOptions]);

  const expected = parsePositiveQuantity(value.baseQuantity);
  return (
    <div className="rounded-xl border border-secondary-200 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-medium text-secondary-900">{input.productName}</p>
          <p className="font-mono text-xs text-secondary-500">{input.productSku}</p>
        </div>
        <QuantityInput
          label={t('transformations.execute.actualInput')}
          value={value.baseQuantity}
          onChange={baseQuantity => onChange({ ...value, baseQuantity })}
        />
      </div>
      {input.tracksLots && !lotsQuery.error && (
        <ExactLotAllocationEditor
          idPrefix={`transformation-${input.id}`}
          options={options}
          value={value.allocations}
          expectedQuantity={expected}
          disabled={disabled || lotsQuery.isLoading}
          onChange={allocations => onChange({ ...value, allocations })}
        />
      )}
      {input.tracksLots && lotsQuery.error && (
        <p className="mt-3 text-sm text-danger-700" role="alert">
          {t('transformations.execute.lotsError')}
        </p>
      )}
      {input.tracksLots ? (
        !lotsQuery.error && (
          <ExactLotAllocationEditor
            idPrefix={`transformation-waste-${input.id}`}
            options={wasteOptions}
            value={value.wasteAllocations}
            disabled={disabled}
            title={t('transformations.execute.wasteLotsTitle')}
            help={t('transformations.execute.wasteLotsHelp')}
            emptyMessage={t('transformations.execute.wasteLotsEmpty')}
            onChange={wasteAllocations => onChange({ ...value, wasteAllocations })}
          />
        )
      ) : (
        <div className="mt-4 max-w-xs">
          <QuantityInput
            label={t('transformations.execute.wasteQuantity')}
            value={value.wasteQuantity}
            onChange={wasteQuantity => onChange({ ...value, wasteQuantity })}
          />
        </div>
      )}
      <div className="mt-4">
        <label className="block">
          <span className="label">{t('transformations.execute.wasteReason')}</span>
          <input
            className="input mt-1"
            value={value.wasteReason}
            maxLength={500}
            disabled={
              disabled ||
              Boolean(lotsQuery.error) ||
              (input.tracksLots
                ? sumExactLotAllocations(value.wasteAllocations) <= 0
                : parsePositiveQuantity(value.wasteQuantity) <= 0)
            }
            onChange={event => onChange({ ...value, wasteReason: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

function ExecuteModal({
  recipe,
  siteId,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  recipe: TransformationRecipe;
  siteId: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: {
    recipeId: string;
    siteId: string;
    notes?: string;
    inputs: Array<{
      recipeInputId: string;
      baseQuantity: number;
      lotAllocations?: Array<{ lotId: string; baseQuantity: number }>;
    }>;
    outputs: Array<{
      recipeOutputId: string;
      baseQuantity: number;
      allocationWeight: number;
      lot?: { lotNumber: string; expiresAt?: string | null };
    }>;
    waste: Array<{
      recipeInputId: string;
      lotId?: string;
      baseQuantity: number;
      reason: string;
    }>;
  }) => Promise<void>;
}) {
  const { t } = useTranslation('inventory');
  const [inputs, setInputs] = useState<Record<string, ExecutionInputDraft>>(() =>
    Object.fromEntries(
      recipe.inputs.map(input => [
        input.id,
        {
          baseQuantity: String(input.baseQuantity),
          allocations: {},
          wasteQuantity: '',
          wasteAllocations: {},
          wasteReason: '',
        },
      ])
    )
  );
  const [outputs, setOutputs] = useState<Record<string, ExecutionOutputDraft>>(() =>
    Object.fromEntries(
      recipe.outputs.map(output => [
        output.id,
        {
          baseQuantity: String(output.expectedBaseQuantity),
          allocationWeight: String(output.allocationWeight),
          lotNumber: '',
          expiresAt: '',
        },
      ])
    )
  );
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lotOptionsByInput, setLotOptionsByInput] = useState<Record<string, ExactLotOption[]>>({});
  const handleLotOptionsChange = useCallback((recipeInputId: string, options: ExactLotOption[]) => {
    setLotOptionsByInput(current =>
      haveSameExactLotOptions(current[recipeInputId], options)
        ? current
        : { ...current, [recipeInputId]: options }
    );
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const normalizedInputs = [];
    const waste = [];
    for (const input of recipe.inputs) {
      const draft = inputs[input.id]!;
      const baseQuantity = parsePositiveQuantity(draft.baseQuantity);
      if (baseQuantity <= 0) {
        setFormError(t('transformations.execute.invalid'));
        return;
      }
      const options = lotOptionsByInput[input.id] ?? [];
      const allocations = input.tracksLots
        ? normalizeExactLotAllocations(options, draft.allocations)
        : null;
      if (
        input.tracksLots &&
        (!allocations ||
          !quantitiesMatch(
            allocations.reduce((sum, allocation) => sum + allocation.quantity, 0),
            baseQuantity
          ))
      ) {
        setFormError(t('transformations.execute.invalidLots'));
        return;
      }
      normalizedInputs.push({
        recipeInputId: input.id,
        baseQuantity,
        ...(allocations
          ? {
              lotAllocations: allocations.map(allocation => ({
                lotId: allocation.lotId,
                baseQuantity: allocation.quantity,
              })),
            }
          : {}),
      });
      if (input.tracksLots) {
        const wasteOptions = (allocations ?? []).map(allocation => ({
          id: allocation.lotId,
          lotNumber: allocation.lotId,
          availableQuantity: allocation.quantity,
        }));
        const wasteAllocations = normalizeExactLotAllocations(wasteOptions, draft.wasteAllocations);
        if (sumExactLotAllocations(draft.wasteAllocations) > 0 && !wasteAllocations) {
          setFormError(t('transformations.execute.invalidWaste'));
          return;
        }
        if (wasteAllocations) {
          if (!draft.wasteReason.trim()) {
            setFormError(t('transformations.execute.invalidWaste'));
            return;
          }
          waste.push(
            ...wasteAllocations.map(allocation => ({
              recipeInputId: input.id,
              lotId: allocation.lotId,
              baseQuantity: allocation.quantity,
              reason: draft.wasteReason.trim(),
            }))
          );
        }
      } else {
        const wasteQuantity = parsePositiveQuantity(draft.wasteQuantity);
        if (wasteQuantity > 0) {
          if (!draft.wasteReason.trim() || wasteQuantity > baseQuantity) {
            setFormError(t('transformations.execute.invalidWaste'));
            return;
          }
          waste.push({
            recipeInputId: input.id,
            baseQuantity: wasteQuantity,
            reason: draft.wasteReason.trim(),
          });
        }
      }
    }

    const normalizedOutputs = [];
    for (const output of recipe.outputs) {
      const draft = outputs[output.id]!;
      const baseQuantity = parsePositiveQuantity(draft.baseQuantity);
      const allocationWeight = parsePositiveQuantity(draft.allocationWeight);
      if (
        baseQuantity <= 0 ||
        allocationWeight <= 0 ||
        (output.tracksLots && !draft.lotNumber.trim())
      ) {
        setFormError(t('transformations.execute.invalidOutputs'));
        return;
      }
      normalizedOutputs.push({
        recipeOutputId: output.id,
        baseQuantity,
        allocationWeight,
        ...(output.tracksLots
          ? {
              lot: {
                lotNumber: draft.lotNumber.trim(),
                ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
              },
            }
          : {}),
      });
    }
    try {
      await onSubmit({
        recipeId: recipe.id,
        siteId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        inputs: normalizedInputs,
        outputs: normalizedOutputs,
        waste,
      });
    } catch {
      // The mutation keeps the modal open and owns the localized error surface.
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('transformations.execute.title', { recipe: recipe.name })}
      size="full"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>
            {t('transformations.actions.cancel')}
          </button>
          <button
            type="submit"
            form="inventory-transformation-execute-form"
            className="btn-primary"
            disabled={saving}
          >
            {saving ? t('transformations.actions.executing') : t('transformations.actions.execute')}
          </button>
        </div>
      }
    >
      <form
        id="inventory-transformation-execute-form"
        className="space-y-5"
        onSubmit={handleSubmit}
      >
        <div className="space-y-3">
          <h3 className="font-medium text-secondary-900">{t('transformations.execute.inputs')}</h3>
          {recipe.inputs.map(input => (
            <TransformationInputEditor
              key={input.id}
              siteId={siteId}
              input={input}
              value={inputs[input.id]!}
              disabled={saving}
              onChange={value => setInputs(current => ({ ...current, [input.id]: value }))}
              onOptionsChange={handleLotOptionsChange}
            />
          ))}
        </div>

        <div className="space-y-3">
          <h3 className="font-medium text-secondary-900">{t('transformations.execute.outputs')}</h3>
          {recipe.outputs.map(output => {
            const value = outputs[output.id]!;
            return (
              <div key={output.id} className="rounded-xl border border-secondary-200 p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="mr-auto">
                    <p className="font-medium text-secondary-900">{output.productName}</p>
                    <p className="font-mono text-xs text-secondary-500">{output.productSku}</p>
                  </div>
                  <QuantityInput
                    label={t('transformations.execute.actualOutput')}
                    value={value.baseQuantity}
                    onChange={baseQuantity =>
                      setOutputs(current => ({
                        ...current,
                        [output.id]: { ...value, baseQuantity },
                      }))
                    }
                  />
                  <QuantityInput
                    label={t('transformations.recipe.weight')}
                    value={value.allocationWeight}
                    onChange={allocationWeight =>
                      setOutputs(current => ({
                        ...current,
                        [output.id]: { ...value, allocationWeight },
                      }))
                    }
                  />
                </div>
                {output.tracksLots && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="label">{t('transformations.execute.newLot')}</span>
                      <input
                        className="input mt-1"
                        value={value.lotNumber}
                        maxLength={120}
                        onChange={event =>
                          setOutputs(current => ({
                            ...current,
                            [output.id]: { ...value, lotNumber: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="block">
                      <span className="label">{t('transformations.execute.expiresAt')}</span>
                      <input
                        type="date"
                        className="input mt-1"
                        value={value.expiresAt}
                        onChange={event =>
                          setOutputs(current => ({
                            ...current,
                            [output.id]: { ...value, expiresAt: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <label className="block">
          <span className="label">{t('transformations.execute.notes')}</span>
          <textarea
            className="input mt-1"
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={event => setNotes(event.target.value)}
          />
        </label>
        {(formError || error) && (
          <p className="text-sm text-danger-700" role="alert">
            {formError ?? error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function TransformationDetailsModal({
  details,
  loading,
  error,
  onClose,
}: {
  details: TransformationDetails | undefined;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('inventory');
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={details?.recipeNameSnapshot ?? t('transformations.details.title')}
      size="full"
    >
      {loading && <p className="text-sm text-secondary-500">{t('transformations.loading')}</p>}
      {error && (
        <p className="text-sm text-danger-700" role="alert">
          {error}
        </p>
      )}
      {details && (
        <div className="space-y-5" data-testid="inventory-transformation-details">
          <dl className="grid gap-3 rounded-xl border border-secondary-200 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-medium uppercase text-secondary-500">
                {t('transformations.details.status')}
              </dt>
              <dd className="mt-1 text-sm text-secondary-900">
                {t(`transformations.status.${details.status}`)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-secondary-500">
                {t('transformations.details.executedAt')}
              </dt>
              <dd className="mt-1 text-sm text-secondary-900">
                {formatDateTime(details.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-secondary-500">
                {t('transformations.details.executedBy')}
              </dt>
              <dd className="mt-1 text-sm text-secondary-900">{details.executedByName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-secondary-500">
                {t('transformations.details.site')}
              </dt>
              <dd className="mt-1 text-sm text-secondary-900">{details.siteName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-secondary-500">
                {t('transformations.details.inputCost')}
              </dt>
              <dd className="mt-1 text-sm text-secondary-900">
                {formatCurrency(details.totalInputCost)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-secondary-500">
                {t('transformations.details.outputCost')}
              </dt>
              <dd className="mt-1 text-sm text-secondary-900">
                {formatCurrency(details.totalOutputCost)}
              </dd>
            </div>
          </dl>

          {details.notes && (
            <div className="rounded-xl bg-secondary-50 p-4 text-sm text-secondary-700">
              <p className="font-medium text-secondary-900">{t('transformations.details.notes')}</p>
              <p className="mt-1 whitespace-pre-wrap">{details.notes}</p>
            </div>
          )}

          <section aria-labelledby="transformation-details-inputs">
            <h3 id="transformation-details-inputs" className="font-medium text-secondary-900">
              {t('transformations.details.inputs')}
            </h3>
            <div className="mt-2 overflow-x-auto rounded-xl border border-secondary-200">
              <table className="min-w-full divide-y divide-secondary-200 text-sm">
                <thead className="bg-secondary-50 text-left text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('transformations.details.product')}</th>
                    <th className="px-3 py-2">{t('transformations.details.lot')}</th>
                    <th className="px-3 py-2 text-right">
                      {t('transformations.details.quantity')}
                    </th>
                    <th className="px-3 py-2 text-right">
                      {t('transformations.details.unitCost')}
                    </th>
                    <th className="px-3 py-2 text-right">
                      {t('transformations.details.totalCost')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-200">
                  {details.inputs.map(input => (
                    <tr key={input.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-secondary-900">{input.productName}</p>
                        <p className="font-mono text-xs text-secondary-500">{input.productSku}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p>{input.lotNumber ?? t('transformations.details.notLotTracked')}</p>
                        {input.lotNumber && input.sourceStatus && (
                          <p className="text-xs text-secondary-500">
                            {t('lots.allocation.metadata', {
                              status: t(`lots.allocation.statuses.${input.sourceStatus}`, {
                                defaultValue: t('lots.allocation.unknownStatus'),
                              }),
                              expiry: input.expiresAt
                                ? formatLotExpiryDate(input.expiresAt)
                                : t('lots.allocation.noExpiry'),
                            })}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatQuantity(input.baseQuantity)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(input.unitCost)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(input.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="transformation-details-outputs">
            <h3 id="transformation-details-outputs" className="font-medium text-secondary-900">
              {t('transformations.details.outputs')}
            </h3>
            <div className="mt-2 overflow-x-auto rounded-xl border border-secondary-200">
              <table className="min-w-full divide-y divide-secondary-200 text-sm">
                <thead className="bg-secondary-50 text-left text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="px-3 py-2">{t('transformations.details.product')}</th>
                    <th className="px-3 py-2">{t('transformations.details.role')}</th>
                    <th className="px-3 py-2">{t('transformations.details.lot')}</th>
                    <th className="px-3 py-2 text-right">
                      {t('transformations.details.quantity')}
                    </th>
                    <th className="px-3 py-2 text-right">
                      {t('transformations.details.allocatedCost')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-200">
                  {details.outputs.map(output => (
                    <tr key={output.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-secondary-900">{output.productName}</p>
                        <p className="font-mono text-xs text-secondary-500">{output.productSku}</p>
                      </td>
                      <td className="px-3 py-2">{t(`transformations.roles.${output.role}`)}</td>
                      <td className="px-3 py-2">
                        <p>{output.lotNumber ?? t('transformations.details.notLotTracked')}</p>
                        {output.expiresAt && (
                          <p className="text-xs text-secondary-500">
                            {t('transformations.details.expires', {
                              date: formatLotExpiryDate(output.expiresAt),
                            })}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatQuantity(output.baseQuantity)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(output.allocatedCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="transformation-details-waste">
            <h3 id="transformation-details-waste" className="font-medium text-secondary-900">
              {t('transformations.details.waste')}
            </h3>
            {details.waste.length === 0 ? (
              <p className="mt-2 text-sm text-secondary-500">
                {t('transformations.details.noWaste')}
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-secondary-200 rounded-xl border border-secondary-200">
                {details.waste.map(waste => {
                  const input = details.inputs.find(
                    candidate => candidate.id === waste.transformationInputId
                  );
                  return (
                    <li key={waste.id} className="flex flex-wrap justify-between gap-3 p-3 text-sm">
                      <div>
                        <p className="font-medium text-secondary-900">
                          {input?.productName ?? t('transformations.details.unknownInput')}
                        </p>
                        <p className="text-secondary-500">
                          {input?.lotNumber ?? t('transformations.details.notLotTracked')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium tabular-nums">
                          {formatQuantity(waste.baseQuantity)}
                        </p>
                        <p className="text-secondary-500">{waste.reason}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {details.status === 'voided' && (
            <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900">
              <p className="font-medium">{t('transformations.details.voided')}</p>
              <p className="mt-1">{details.voidReason}</p>
              {details.voidedAt && (
                <p className="mt-1 text-xs">{formatDateTime(details.voidedAt)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function InventoryTransformationsPanel({ siteId }: { siteId: string | null }) {
  const { t } = useTranslation(['inventory', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [recipeModal, setRecipeModal] = useState<TransformationRecipe | 'new' | null>(null);
  const [executeRecipe, setExecuteRecipe] = useState<TransformationRecipe | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<TransformationHistory | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [recipeSearchText, setRecipeSearchText] = useState('');
  const [historyCursor, setHistoryCursor] = useState({ siteId, page: 0 });
  const historyPage = historyCursor.siteId === siteId ? historyCursor.page : 0;
  const debouncedRecipeSearch = useDebouncedValue(recipeSearchText.trim(), 200);

  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: 200, isActive: true },
    { enabled: !!siteId }
  );
  const recipesQuery = trpc.inventoryTransformations.listRecipes.useQuery(
    {
      siteId: siteId ?? undefined,
      activeOnly: false,
      limit: 50,
      ...(debouncedRecipeSearch ? { q: debouncedRecipeSearch } : {}),
    },
    { enabled: !!siteId }
  );
  const historyQuery = trpc.inventoryTransformations.list.useQuery(
    { page: historyPage + 1, perPage: 50, siteId: siteId ?? undefined },
    { enabled: !!siteId }
  );
  const detailsQuery = trpc.inventoryTransformations.getById.useQuery(
    { id: detailId ?? '' },
    { enabled: detailId !== null }
  );
  const products = ((productsQuery.data?.items ?? []) as Product[]).filter(
    product =>
      product.tracksStock && !product.tracksSerials && product.catalogType !== 'variant_parent'
  );
  const recipes = recipesQuery.data?.items ?? [];
  const history = historyQuery.data?.items ?? [];

  async function invalidateAll() {
    await Promise.all([
      utils.inventoryTransformations.listRecipes.invalidate(),
      utils.inventoryTransformations.getRecipe.invalidate(),
      utils.inventoryTransformations.list.invalidate(),
      utils.inventoryTransformations.getById.invalidate(),
      utils.inventory.listMovements.invalidate(),
      utils.inventory.listBalancesBySite.invalidate(),
      utils.inventory.listStock.invalidate(),
      utils.inventoryLots.list.invalidate(),
      utils.products.list.invalidate(),
      utils.products.search.invalidate(),
    ]);
  }

  const createRecipe = useCriticalMutation('inventoryTransformations.createRecipe', {
    onSuccess: async () => {
      setRecipeModal(null);
      await invalidateAll();
      toast.success({ title: t('inventory:transformations.toast.recipeSaved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:transformations.toast.error' }),
  });
  const updateRecipe = useCriticalMutation('inventoryTransformations.updateRecipe', {
    onSuccess: async () => {
      setRecipeModal(null);
      await invalidateAll();
      toast.success({ title: t('inventory:transformations.toast.recipeSaved') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:transformations.toast.error' }),
  });
  const execute = useCriticalMutation('inventoryTransformations.execute', {
    onSuccess: async () => {
      setExecuteRecipe(null);
      await invalidateAll();
      toast.success({ title: t('inventory:transformations.toast.executed') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:transformations.toast.error' }),
  });
  const voidMutation = useCriticalMutation('inventoryTransformations.void', {
    onSuccess: async () => {
      setVoidTarget(null);
      setVoidReason('');
      await invalidateAll();
      toast.success({ title: t('inventory:transformations.toast.voided') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:transformations.toast.error' }),
  });

  function openRecipeModal(recipe: TransformationRecipe | 'new') {
    createRecipe.reset();
    updateRecipe.reset();
    setRecipeModal(recipe);
  }

  function closeRecipeModal() {
    createRecipe.reset();
    updateRecipe.reset();
    setRecipeModal(null);
  }

  function openExecuteModal(recipe: TransformationRecipe) {
    execute.reset();
    setExecuteRecipe(recipe);
  }

  function closeExecuteModal() {
    execute.reset();
    setExecuteRecipe(null);
  }

  function openVoidModal(item: TransformationHistory) {
    voidMutation.reset();
    setVoidReason('');
    setVoidTarget(item);
  }

  function closeVoidModal() {
    voidMutation.reset();
    setVoidReason('');
    setVoidTarget(null);
  }

  if (!siteId) {
    return (
      <div className="card p-6 text-sm text-warning-700">
        {t('inventory:transformations.noSite')}
      </div>
    );
  }

  const recipeError = createRecipe.error ?? updateRecipe.error;
  return (
    <div className="space-y-5" data-testid="inventory-transformations-panel">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('inventory:transformations.title')}
          </h2>
          <p className="text-sm text-secondary-500">{t('inventory:transformations.description')}</p>
        </div>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => openRecipeModal('new')}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('inventory:transformations.recipe.new')}
        </button>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-medium text-secondary-900">
            {t('inventory:transformations.recipe.saved')}
          </h3>
          <label className="block w-full sm:w-72">
            <span className="sr-only">{t('inventory:transformations.recipe.searchLabel')}</span>
            <input
              type="search"
              className="input"
              value={recipeSearchText}
              placeholder={t('inventory:transformations.recipe.searchPlaceholder')}
              onChange={event => setRecipeSearchText(event.target.value)}
            />
          </label>
        </div>
        {recipesQuery.isLoading && (
          <p className="mt-3 text-sm text-secondary-500">
            {t('inventory:transformations.loading')}
          </p>
        )}
        {recipesQuery.error && (
          <p className="mt-3 text-sm text-danger-700" role="alert">
            {translateServerError(
              recipesQuery.error,
              t,
              t('inventory:transformations.recipe.loadError')
            )}
          </p>
        )}
        {!recipesQuery.isLoading && !recipesQuery.error && recipes.length === 0 && (
          <EmptyState
            icon={RotateCcw}
            title={t(
              debouncedRecipeSearch
                ? 'inventory:transformations.recipe.searchEmptyTitle'
                : 'inventory:transformations.recipe.emptyTitle'
            )}
            description={t(
              debouncedRecipeSearch
                ? 'inventory:transformations.recipe.searchEmptyDescription'
                : 'inventory:transformations.recipe.emptyDescription'
            )}
          />
        )}
        {recipesQuery.data?.hasMore && (
          <p className="mt-3 text-sm text-warning-700" role="status">
            {t('inventory:transformations.recipe.searchTruncated')}
          </p>
        )}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {recipes.map(recipe => (
            <article key={recipe.id} className="rounded-xl border border-secondary-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-secondary-900">{recipe.name}</p>
                  <p className="text-xs text-secondary-500">
                    {t(`inventory:transformations.kinds.${recipe.kind}`)} ·{' '}
                    {t('inventory:transformations.recipe.lineSummary', {
                      inputs: recipe.inputs.length,
                      outputs: recipe.outputs.length,
                    })}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    recipe.isActive
                      ? 'bg-success-100 text-success-700'
                      : 'bg-secondary-100 text-secondary-600'
                  }`}
                >
                  {t(
                    recipe.isActive
                      ? 'inventory:transformations.recipe.activeBadge'
                      : 'inventory:transformations.recipe.inactiveBadge'
                  )}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 py-1.5 text-sm"
                  onClick={() => openRecipeModal(recipe)}
                >
                  <Edit3 className="h-4 w-4" aria-hidden="true" />
                  {t('inventory:transformations.actions.edit')}
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1 py-1.5 text-sm"
                  disabled={!recipe.isActive}
                  onClick={() => openExecuteModal(recipe)}
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {t('inventory:transformations.actions.execute')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-medium text-secondary-900">
          {t('inventory:transformations.history.title')}
        </h3>
        {historyQuery.isLoading && (
          <p className="mt-3 text-sm text-secondary-500">
            {t('inventory:transformations.loading')}
          </p>
        )}
        {historyQuery.error && (
          <p className="mt-3 text-sm text-danger-700" role="alert">
            {translateServerError(
              historyQuery.error,
              t,
              t('inventory:transformations.history.error')
            )}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {history.map(item => (
            <article
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary-200 p-4"
            >
              <div>
                <p className="font-medium text-secondary-900">{item.recipeNameSnapshot}</p>
                <p className="text-xs text-secondary-500">
                  {formatDateTime(item.createdAt)} · {item.executedByName} ·{' '}
                  {formatCurrency(item.totalInputCost)}
                </p>
                <p className="text-xs text-secondary-500">
                  {t('inventory:transformations.history.lineSummary', {
                    inputs: item.inputCount,
                    outputs: item.outputCount,
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-secondary-600">
                  {t(`inventory:transformations.status.${item.status}`)}
                </span>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 py-1.5 text-sm"
                  onClick={() => setDetailId(item.id)}
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  {t('inventory:transformations.actions.details')}
                </button>
                {item.status === 'completed' && (
                  <button
                    type="button"
                    className="btn-secondary py-1.5 text-sm"
                    onClick={() => openVoidModal(item)}
                  >
                    {t('inventory:transformations.actions.void')}
                  </button>
                )}
              </div>
            </article>
          ))}
          {!historyQuery.isLoading && !historyQuery.error && history.length === 0 && (
            <p className="text-sm text-secondary-500">
              {t('inventory:transformations.history.empty')}
            </p>
          )}
        </div>
        <div className="mt-3">
          <TablePagination
            page={historyPage}
            pageCount={historyQuery.data?.totalPages ?? 0}
            total={historyQuery.data?.totalItems ?? 0}
            rangeStart={history.length === 0 ? 0 : historyPage * 50 + 1}
            rangeEnd={historyPage * 50 + history.length}
            onPageChange={page => setHistoryCursor({ siteId, page })}
          />
        </div>
      </div>

      {recipeModal && (
        <RecipeModal
          key={recipeModal === 'new' ? 'new' : `${recipeModal.id}:${recipeModal.version}`}
          recipe={recipeModal === 'new' ? null : recipeModal}
          siteId={siteId}
          products={products}
          saving={createRecipe.isPending || updateRecipe.isPending}
          error={
            recipeError
              ? translateServerError(recipeError, t, t('inventory:transformations.error'))
              : null
          }
          onClose={closeRecipeModal}
          onSubmit={async value => {
            if (value.id && value.version !== undefined) {
              await updateRecipe.mutateAsync({ ...value, id: value.id, version: value.version });
            } else {
              await createRecipe.mutateAsync({
                siteId: value.siteId,
                name: value.name,
                kind: value.kind,
                notes: value.notes,
                isActive: value.isActive,
                inputs: value.inputs,
                outputs: value.outputs,
              });
            }
          }}
        />
      )}

      {executeRecipe && (
        <ExecuteModal
          key={executeRecipe.id}
          recipe={executeRecipe}
          siteId={siteId}
          saving={execute.isPending}
          error={
            execute.error
              ? translateServerError(execute.error, t, t('inventory:transformations.error'))
              : null
          }
          onClose={closeExecuteModal}
          onSubmit={value => execute.mutateAsync(value).then(() => undefined)}
        />
      )}

      {detailId && (
        <TransformationDetailsModal
          details={detailsQuery.data}
          loading={detailsQuery.isLoading}
          error={
            detailsQuery.error
              ? translateServerError(
                  detailsQuery.error,
                  t,
                  t('inventory:transformations.details.error')
                )
              : null
          }
          onClose={() => setDetailId(null)}
        />
      )}

      {voidTarget && (
        <Modal
          isOpen
          onClose={closeVoidModal}
          title={t('inventory:transformations.void.title')}
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={voidMutation.isPending}
                onClick={closeVoidModal}
              >
                {t('inventory:transformations.actions.cancel')}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={voidMutation.isPending || voidReason.trim().length < 3}
                onClick={() =>
                  voidMutation.mutate({ id: voidTarget.id, reason: voidReason.trim() })
                }
              >
                {t('inventory:transformations.actions.void')}
              </button>
            </div>
          }
        >
          <p className="text-sm text-secondary-600">
            {t('inventory:transformations.void.description')}
          </p>
          <label className="mt-4 block">
            <span className="label">{t('inventory:transformations.void.reason')}</span>
            <textarea
              className="input mt-1"
              rows={3}
              maxLength={500}
              value={voidReason}
              onChange={event => setVoidReason(event.target.value)}
            />
          </label>
        </Modal>
      )}
    </div>
  );
}
