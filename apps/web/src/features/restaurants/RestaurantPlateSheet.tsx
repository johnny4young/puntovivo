import { lazy, Suspense, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole, Minus, Plus, X } from 'lucide-react';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { trpc } from '@/lib/trpc';
import { roundMoney } from '@/lib/money';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { groupRule } from './modifierGroupRule';
import {
  getRestaurantModifierPriceDelta,
  RESTAURANT_COURSE_KEYS,
  RESTAURANT_MODIFIER_LIMIT,
  type RestaurantLineDraft,
  type RestaurantModifierDraft,
} from './restaurantDraft';

const RestaurantModifierPicker = lazy(() =>
  import('./RestaurantModifierPicker').then(module => ({
    default: module.RestaurantModifierPicker,
  }))
);

type ProductGroup = inferRouterOutputs<AppRouter>['restaurantModifiers']['productGroups'][number];
type GroupOption = ProductGroup['options'][number];

const KITCHEN_NOTE_MAX = 280;

function PriceTag({ amount }: { amount: number }) {
  const { t } = useTranslation('restaurants');
  if (amount <= 0) return null;
  return (
    <small className="tabular-nums">
      {t('sheet.extraPrice', { price: formatCurrency(amount) })}
    </small>
  );
}

export interface RestaurantPlateSheetProps {
  siteId: string;
  productId: string;
  productName: string;
  /** Price of one plate before add-ons. */
  unitPrice: number;
  quantity: number;
  minQuantity: number;
  quantityStep: number;
  guestCount: number;
  canManage: boolean;
  initialDetail: RestaurantLineDraft;
  initialNote: string;
  mode: 'add' | 'edit';
  onSubmit: (detail: RestaurantLineDraft, note: string, quantity: number) => void;
  onClose: () => void;
}

/** One sheet per plate: who it is for, the dish's option groups, the course and a kitchen note. */
export function RestaurantPlateSheet({
  siteId,
  productId,
  productName,
  unitPrice,
  quantity: initialQuantity,
  minQuantity,
  quantityStep,
  guestCount,
  canManage,
  initialDetail,
  initialNote,
  mode,
  onSubmit,
  onClose,
}: RestaurantPlateSheetProps) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const id = useId();
  const [seatNumber, setSeatNumber] = useState(initialDetail.seatNumber);
  const [courseKey, setCourseKey] = useState(initialDetail.courseKey);
  const [modifiers, setModifiers] = useState(initialDetail.modifiers);
  const [note, setNote] = useState(initialNote);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [noteOpen, setNoteOpen] = useState(initialNote.trim().length > 0);
  const [showMissing, setShowMissing] = useState(false);
  const [picking, setPicking] = useState(false);
  const nextId = useRef(0);
  const groupsQuery = trpc.restaurantModifiers.productGroups.useQuery(
    { siteId, productId },
    { staleTime: 30_000 }
  );
  const groups = groupsQuery.data ?? [];
  const inGroup = (group: ProductGroup, modifier: RestaurantModifierDraft) =>
    modifier.groupId === group.id &&
    group.options.some(option => option.catalogId === modifier.catalogId);
  // A pick whose option left its group stays visible here so it can be removed.
  const ungrouped = modifiers.filter(modifier => !groups.some(group => inGroup(group, modifier)));
  const full = modifiers.length >= RESTAURANT_MODIFIER_LIMIT;
  const picked = (group: ProductGroup) => modifiers.filter(modifier => inGroup(group, modifier));
  const takenNames = new Set(modifiers.map(modifier => modifier.name.trim().toLowerCase()));
  const missing = groups.filter(group => picked(group).length < group.minSelections);
  const platePrice = roundMoney(unitPrice + getRestaurantModifierPriceDelta(modifiers));
  const hasExtraGroup = groups.some(group => group.kind === 'extra');

  function toggle(group: ProductGroup, option: GroupOption): void {
    const current = picked(group).find(modifier => modifier.catalogId === option.catalogId);
    if (current) {
      setModifiers(modifiers.filter(modifier => modifier !== current));
      return;
    }
    // A single-choice group swaps its pick instead of adding a second one.
    const next =
      group.maxSelections === 1
        ? modifiers.filter(modifier => modifier.groupId !== group.id)
        : modifiers;
    if (next.length >= RESTAURANT_MODIFIER_LIMIT) return;
    setModifiers([
      ...next,
      {
        id: `${group.id}:${option.catalogId}`,
        catalogId: option.catalogId,
        catalogVersion: option.version,
        maxQuantity: option.maxQuantity,
        groupId: group.id,
        groupKind: group.kind,
        name: option.name,
        quantity: 1,
        unitPriceDelta: option.unitPriceDelta,
      },
    ]);
  }

  function addUngrouped(row: Omit<RestaurantModifierDraft, 'id' | 'quantity'>): void {
    setModifiers(current => {
      // An edited line already holds ids from the sheet that first built it.
      let id: string;
      do id = `extra-${nextId.current++}`;
      while (current.some(modifier => modifier.id === id));
      return [...current, { ...row, id, quantity: 1 }];
    });
    setPicking(false);
  }

  function submit(): void {
    if (missing.length > 0) {
      setShowMissing(true);
      document
        .getElementById(`${id}-group-${missing[0]!.id}`)
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus();
      return;
    }
    onSubmit(
      {
        seatNumber,
        courseKey,
        modifiers,
        modifierGroups:
          groups.length > 0
            ? groups.map(group => ({ id: group.id, version: group.version }))
            : undefined,
      },
      note.trim(),
      quantity
    );
  }

  const chip = (pressed: boolean) => ({
    type: 'button' as const,
    'aria-pressed': pressed,
    className: 'modifier-option',
  });
  const sectionLabel = 'text-xs font-semibold uppercase tracking-[0.14em] text-fg3';

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex h-full min-h-0 flex-col"
      data-testid="plate-sheet"
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <h2 id={`${id}-title`} className="font-display text-2xl font-bold text-fg1">
          {productName}
        </h2>
        <div className="flex shrink-0 items-start gap-2">
          <span
            className="font-display text-2xl font-bold tabular-nums text-fg1"
            data-testid="plate-sheet-price"
          >
            {formatCurrency(platePrice)}
          </span>
          <button
            type="button"
            className="btn-ghost btn-icon -mr-2 -mt-1 min-h-11 min-w-11"
            aria-label={t('common:actions.close')}
            onClick={onClose}
            data-testid="plate-sheet-close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-4 pt-4">
        <div role="group" aria-labelledby={`${id}-seat`} className="space-y-2">
          <h3 id={`${id}-seat`} className={sectionLabel}>
            {t('sheet.forWhom')}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              {...chip(seatNumber === null)}
              onClick={() => setSeatNumber(null)}
              data-testid="plate-sheet-seat-shared"
            >
              {t('sheet.wholeTable')}
            </button>
            {Array.from({ length: guestCount }, (_, index) => index + 1).map(seat => (
              <button
                key={seat}
                {...chip(seatNumber === seat)}
                onClick={() => setSeatNumber(seat)}
                data-testid={`plate-sheet-seat-${seat}`}
              >
                {t('sheet.diner', { count: seat })}
              </button>
            ))}
          </div>
        </div>

        {groupsQuery.isLoading && (
          <p role="status" className="text-sm text-fg3">
            {t('sheet.loading')}
          </p>
        )}
        {groupsQuery.error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger-700">
            <span>{translateServerError(groupsQuery.error, t, t('sheet.groupsError'))}</span>
            <button
              type="button"
              className="btn-outline min-h-11"
              onClick={() => void groupsQuery.refetch()}
            >
              {t('common:actions.retry')}
            </button>
          </div>
        )}

        {groups.map(group => {
          const selected = picked(group);
          const atMax = selected.length >= group.maxSelections && group.maxSelections > 1;
          const isMissing = showMissing && missing.includes(group);
          return (
            <div
              key={group.id}
              id={`${id}-group-${group.id}`}
              role="group"
              aria-labelledby={`${id}-group-${group.id}-title`}
              className="space-y-2"
              data-testid={`plate-sheet-group-${group.id}`}
            >
              <h3
                id={`${id}-group-${group.id}-title`}
                className={`${sectionLabel} ${isMissing ? 'text-danger-700' : ''}`}
              >
                {group.name} · {groupRule(t, group)}
              </h3>
              <div className="flex flex-wrap gap-2">
                {group.options.map(option => {
                  const pressed = selected.some(
                    modifier => modifier.catalogId === option.catalogId
                  );
                  // Line modifier names must be unique, so a same-named add-on blocks the option.
                  const elsewhere =
                    !pressed &&
                    (modifiers.some(modifier => modifier.catalogId === option.catalogId) ||
                      takenNames.has(option.name.trim().toLowerCase()));
                  const restricted = option.requiresManager && !canManage;
                  const noRoom = full && (group.maxSelections !== 1 || selected.length === 0);
                  return (
                    <button
                      key={option.catalogId}
                      {...chip(pressed)}
                      disabled={!pressed && (restricted || elsewhere || atMax || noRoom)}
                      onClick={() => toggle(group, option)}
                      data-testid={`plate-sheet-option-${option.catalogId}`}
                    >
                      {option.name}
                      <PriceTag amount={option.unitPriceDelta} />
                      {restricted && (
                        <LockKeyhole className="h-4 w-4" aria-label={t('catalog.managerOnly')} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div role="group" aria-labelledby={`${id}-extras`} className="space-y-2">
          <h3 id={`${id}-extras`} className={sectionLabel}>
            {hasExtraGroup ? t('sheet.otherExtras') : t('groups.kinds.extra')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {ungrouped.map(modifier => (
              <button
                key={modifier.id}
                {...chip(true)}
                aria-label={t('sheet.removeExtra', { name: modifier.name })}
                onClick={() => setModifiers(modifiers.filter(row => row.id !== modifier.id))}
              >
                {modifier.name}
                <PriceTag amount={modifier.unitPriceDelta} />
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              className="modifier-option border-dashed"
              disabled={full}
              onClick={() => setPicking(true)}
              data-testid="plate-sheet-more-extras"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('sheet.moreExtras')}
            </button>
          </div>
        </div>

        <div role="group" aria-labelledby={`${id}-course`} className="space-y-2">
          <h3 id={`${id}-course`} className={sectionLabel}>
            {t('sheet.servedWith')}
          </h3>
          <div className="flex flex-wrap gap-2">
            {RESTAURANT_COURSE_KEYS.map(key => (
              <button
                key={key}
                {...chip(courseKey === key)}
                onClick={() => setCourseKey(key)}
                data-testid={`plate-sheet-course-${key}`}
              >
                {t(`sheet.courses.${key}`)}
              </button>
            ))}
          </div>
        </div>

        {noteOpen && (
          <label className="block space-y-2">
            <span className={sectionLabel}>{t('sheet.kitchenNote')}</span>
            <textarea
              className="input min-h-20 w-full text-sm"
              maxLength={KITCHEN_NOTE_MAX}
              value={note}
              autoFocus={note.length === 0}
              onChange={event => setNote(event.target.value)}
              data-testid="plate-sheet-note"
            />
          </label>
        )}
      </div>

      <footer className="space-y-2 border-t border-line px-5 py-4">
        {showMissing && missing.length > 0 && (
          <p role="alert" className="text-sm font-medium text-danger-700">
            {t('sheet.missing', { groups: missing.map(group => group.name).join(', ') })}
          </p>
        )}
        <div className="grid grid-cols-[auto_1fr] gap-2">
          <div
            role="group"
            aria-label={t('sheet.quantity')}
            className="flex items-center rounded-xl border border-line-strong"
          >
            <button
              type="button"
              className="btn-ghost btn-icon h-14 w-11"
              aria-label={t('cart.quantityDecrement')}
              disabled={quantity <= minQuantity}
              onClick={() =>
                setQuantity(roundQuantity(Math.max(minQuantity, quantity - quantityStep), 12))
              }
              data-testid="voice-ordering-qty-decrement"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span
              className="min-w-7 text-center text-lg font-semibold tabular-nums"
              data-testid="voice-ordering-qty"
            >
              {quantity}
            </span>
            <button
              type="button"
              className="btn-ghost btn-icon h-14 w-11"
              aria-label={t('cart.quantityIncrement')}
              onClick={() => setQuantity(roundQuantity(quantity + quantityStep, 12))}
              data-testid="voice-ordering-qty-increment"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="btn-outline min-h-14 px-4 text-base"
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen(open => !open)}
            data-testid="plate-sheet-note-toggle"
          >
            {t('sheet.kitchenNote')}
          </button>
          <button
            type="button"
            className="btn-primary col-span-2 min-h-14 text-lg"
            // Without the dish's groups the plate could skip a required choice.
            disabled={!groupsQuery.data}
            onClick={submit}
            data-testid="plate-sheet-submit"
          >
            {mode === 'add' ? t('sheet.add') : t('sheet.update')}
          </button>
        </div>
      </footer>

      {picking && (
        <Suspense fallback={<p role="status">{t('sheet.loading')}</p>}>
          <RestaurantModifierPicker
            siteId={siteId}
            canManage={canManage}
            // The dish's own options are picked from their group, where its rule applies.
            selectedNames={[
              ...takenNames,
              ...groups.flatMap(group =>
                group.options.map(option => option.name.trim().toLowerCase())
              ),
            ]}
            onClose={() => setPicking(false)}
            onSelect={row =>
              addUngrouped({
                catalogId: row.id,
                catalogVersion: row.version,
                maxQuantity: row.maxQuantity,
                name: row.name,
                unitPriceDelta: row.unitPriceDelta,
              })
            }
            onCustom={
              canManage ? (name, price) => addUngrouped({ name, unitPriceDelta: price }) : undefined
            }
          />
        </Suspense>
      )}
    </section>
  );
}
