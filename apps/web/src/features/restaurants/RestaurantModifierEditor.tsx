import { lazy, Suspense, useId, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  hasDuplicateRestaurantModifiers,
  RESTAURANT_MODIFIER_LIMIT,
  RESTAURANT_MODIFIER_PRICE_MAX,
  type RestaurantModifierDraft,
} from './restaurantDraft';

const RestaurantModifierPicker = lazy(() =>
  import('./RestaurantModifierPicker').then(module => ({
    default: module.RestaurantModifierPicker,
  }))
);

/** A bounded, ordered list for one plate; never merges independently customized sale lines. */
interface RestaurantModifierEditorProps {
  siteId?: string | undefined;
  canManage?: boolean;
  modifiers: RestaurantModifierDraft[];
  disabled: boolean;
  onChange: (modifiers: RestaurantModifierDraft[]) => void;
}

/** Shared keyboard/touch editor for the existing structured modifier snapshot contract. */
export function RestaurantModifierEditor({
  siteId,
  canManage = false,
  modifiers,
  disabled,
  onChange,
}: RestaurantModifierEditorProps) {
  const { t } = useTranslation('restaurants');
  const id = useId();
  const [picking, setPicking] = useState(false);
  const nextId = useRef(0);
  const pendingFocus = useRef<string | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const duplicate = hasDuplicateRestaurantModifiers(modifiers);

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    (inputs.current.get(pendingFocus.current) ?? addButton.current)?.focus();
    pendingFocus.current = null;
  }, [modifiers]);

  function update(rowId: string, patch: Partial<Omit<RestaurantModifierDraft, 'id'>>): void {
    onChange(modifiers.map(row => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 rounded-xl border border-line bg-surface p-3"
      aria-describedby={`${id}-help`}
    >
      <legend className="px-1 text-xs font-semibold text-fg2">{t('cart.modifiersHeading')}</legend>
      <p id={`${id}-help`} className="text-xs text-fg3">
        {t('cart.modifiersHelp')}
      </p>
      {modifiers.map((modifier, index) => (
        <div
          key={modifier.id}
          className="space-y-2 border-b border-line/60 pb-3"
          data-testid="restaurant-modifier-row"
        >
          <div className="flex items-end gap-2">
            <label
              className="min-w-0 flex-1 text-xs font-medium text-fg2"
              htmlFor={`${id}-${modifier.id}-name`}
            >
              {t('cart.modifierLabel')}
              <input
                id={`${id}-${modifier.id}-name`}
                ref={node => {
                  if (node) inputs.current.set(modifier.id, node);
                  else inputs.current.delete(modifier.id);
                }}
                className="input mt-1 min-h-11 w-full text-sm"
                type="text"
                maxLength={80}
                placeholder={t('cart.modifierPlaceholder')}
                readOnly={!!modifier.catalogId}
                value={modifier.name}
                aria-invalid={duplicate || undefined}
                aria-describedby={duplicate ? `${id}-error` : undefined}
                onChange={event => update(modifier.id, { name: event.target.value })}
                data-testid="voice-ordering-modifier-name"
              />
            </label>
            <button
              type="button"
              className="btn-outline btn-icon min-h-11 min-w-11"
              aria-label={t('cart.removeModifier', {
                name: modifier.name.trim() || String(index + 1),
              })}
              onClick={() => {
                const remaining = modifiers.filter(row => row.id !== modifier.id);
                pendingFocus.current = remaining[Math.min(index, remaining.length - 1)]?.id ?? '';
                onChange(remaining);
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <label className="text-xs font-medium text-fg2">
              {t('cart.modifierQuantity')}
              <input
                className="input mt-1 min-h-11 w-full text-sm"
                type="number"
                min={1}
                max={modifier.maxQuantity ?? 20}
                step={1}
                inputMode="numeric"
                value={modifier.quantity}
                disabled={modifier.name.trim().length === 0}
                onChange={event =>
                  update(modifier.id, {
                    quantity: Number.isFinite(event.currentTarget.valueAsNumber)
                      ? Math.max(
                          1,
                          Math.min(
                            modifier.maxQuantity ?? 20,
                            Math.trunc(event.currentTarget.valueAsNumber)
                          )
                        )
                      : 1,
                  })
                }
                data-testid="voice-ordering-modifier-quantity"
              />
            </label>
            <label className="text-xs font-medium text-fg2">
              {t('cart.modifierPrice')}
              <input
                className="input mt-1 min-h-11 w-full text-sm"
                type="number"
                min={0}
                max={RESTAURANT_MODIFIER_PRICE_MAX}
                step="0.01"
                inputMode="decimal"
                readOnly={!!modifier.catalogId || !canManage}
                value={modifier.unitPriceDelta}
                disabled={modifier.name.trim().length === 0}
                onChange={event =>
                  update(modifier.id, {
                    unitPriceDelta: Number.isFinite(event.currentTarget.valueAsNumber)
                      ? Math.min(
                          RESTAURANT_MODIFIER_PRICE_MAX,
                          Math.max(0, event.currentTarget.valueAsNumber)
                        )
                      : 0,
                  })
                }
                data-testid="voice-ordering-modifier-price"
              />
            </label>
          </div>
        </div>
      ))}
      {!canManage && <p className="text-xs text-fg3">{t('catalog.cashierHelp')}</p>}
      {siteId && (
        <button
          type="button"
          className="btn-primary min-h-11 w-full text-sm"
          disabled={
            disabled || modifiers.filter(row => row.name.trim()).length >= RESTAURANT_MODIFIER_LIMIT
          }
          onClick={() => setPicking(true)}
        >
          {t('catalog.choose')}
        </button>
      )}
      {siteId && picking && !disabled && (
        <Suspense fallback={<p role="status">{t('cart.modifiersLoading')}</p>}>
          <RestaurantModifierPicker
            siteId={siteId}
            canManage={canManage}
            selectedNames={modifiers.map(row => row.name.trim().toLowerCase())}
            onClose={() => setPicking(false)}
            onSelect={row => {
              let rowId: string;
              do {
                rowId = `added-${nextId.current++}`;
              } while (modifiers.some(modifier => modifier.id === rowId));
              pendingFocus.current = rowId;
              onChange([
                ...modifiers.filter(modifier => modifier.name.trim()),
                {
                  id: rowId,
                  catalogId: row.id,
                  catalogVersion: row.version,
                  maxQuantity: row.maxQuantity,
                  name: row.name,
                  quantity: 1,
                  unitPriceDelta: row.unitPriceDelta,
                },
              ]);
              setPicking(false);
            }}
          />
        </Suspense>
      )}
      {duplicate && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-700">
          {t('cart.duplicateModifiers')}
        </p>
      )}
      <button
        ref={addButton}
        type="button"
        className="btn-outline min-h-11 w-full text-sm"
        disabled={
          modifiers.length >= RESTAURANT_MODIFIER_LIMIT ||
          modifiers.some(row => !row.name.trim()) ||
          duplicate
        }
        onClick={() => {
          let rowId: string;
          do {
            rowId = `added-${nextId.current++}`;
          } while (modifiers.some(row => row.id === rowId));
          pendingFocus.current = rowId;
          onChange([...modifiers, { id: rowId, name: '', quantity: 1, unitPriceDelta: 0 }]);
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('cart.addModifier')}
      </button>
      {modifiers.length >= RESTAURANT_MODIFIER_LIMIT && (
        <p className="text-xs text-fg3">
          {t('cart.modifiersLimit', { count: RESTAURANT_MODIFIER_LIMIT })}
        </p>
      )}
    </fieldset>
  );
}
