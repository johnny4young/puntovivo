import { useEffect, useMemo, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Sparkles, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import type { LookupOption, ProductFormValues, ProductRole } from './productForm.types';

/**
 * Confidence thresholds for the AI category suggestion.
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

// explicit `| undefined` on optional fields.
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

interface AISuggestionsPanelProps {
  form: UseFormReturn<ProductFormValues>;
  mode: ProductRole;
  isOpen: boolean;
  categories: LookupOption[];
  suggestionsEnabled: boolean;
  // explicit `| undefined` on optional fields.
  productId?: string | undefined;
}

/**
 * owns the AI category-suggestion flow plus the Category field it
 * decorates (label + badge + select + chip). The debounce + reset effects are
 * deliberately written with setState wrapped in setTimeout so they stay React
 * Compiler-safe (async, not synchronous-in-effect). Do not convert them.
 */
export function AISuggestionsPanel({
  form,
  mode,
  isOpen,
  categories,
  suggestionsEnabled,
  productId,
}: AISuggestionsPanelProps) {
  const { t } = useTranslation('products');

  // -------- : AI category suggestion ----------------------------------
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
  }, [isOpen, productId]);

  const suggestedCategory = useMemo(
    () => (suggestion ? (categories.find(c => c.id === suggestion.categoryId) ?? null) : null),
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
  // -------- end  ------------------------------------------------------

  return (
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
  );
}
