import { Suspense, useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { WeighedItemPanel } from '@/features/sales/LazyWeighedItemPanel';
import { buildCartItem, getCartItemKey, type SaleCartItem } from '@/features/sales/saleCart';
import { applyWeighedQuantity, gramsPerUnit } from '@/features/sales/weighedItem';
import type { ProductSearchSelection } from '@/types';

export interface WeighedItemSession {
  id: number;
  selection: ProductSearchSelection;
  grams: number;
  /** Quantity this weighing put on the line; 0 until the cashier picks a weight. */
  applied: number;
  scope: string | null;
}

interface UseWeighedItemParams {
  cartItems: SaleCartItem[];
  setCartItems: Dispatch<SetStateAction<SaleCartItem[]>>;
  /** The ticket it belongs to; another ticket ends it. */
  scope?: string | null;
  /** A locked or charging ticket ends it and opens none. */
  locked?: boolean;
  onApplied?: (lineKey: string) => void;
  className?: string;
}

/** «¿Cuánto pesó?» for by-weight products, gated by the weight/value zone. */
export function useWeighedItem({
  cartItems,
  setCartItems,
  scope = null,
  locked = false,
  onApplied,
  className,
}: UseWeighedItemParams) {
  const enabled = useRegisterZone('weight-value');
  const [session, setSession] = useState<WeighedItemSession | null>(null);
  const nextId = useRef(0);

  const key = session
    ? getCartItemKey(session.selection.product.id, session.selection.unit.unitId)
    : null;
  const line = key ? cartItems.find(item => item.key === key) : undefined;
  // Another ticket, a lock or a line that left (removed, cleared, charged) ends it.
  const stale =
    session !== null &&
    (session.scope !== scope || locked || (session.applied > 0 && line === undefined));

  // Dropped during render so it cannot come back with its ticket.
  if (stale) setSession(null);
  const close = useCallback(() => setSession(null), []);

  /** Opens the panel when the product sells by weight; false means add it as usual. */
  const open = useCallback(
    (selection: ProductSearchSelection) => {
      const grams = enabled && !locked ? gramsPerUnit(selection) : null;
      if (grams === null) return false;
      nextId.current += 1;
      setSession({ id: nextId.current, selection, grams, applied: 0, scope });
      return true;
    },
    [enabled, locked, scope]
  );

  const active = stale ? null : session;
  const panel =
    active && key ? (
      <Suspense fallback={null}>
        <WeighedItemPanel
          key={active.id}
          session={active}
          line={line ?? buildCartItem(active.selection)}
          onApply={quantity => {
            setCartItems(items =>
              applyWeighedQuantity(items, active.selection, active.applied, quantity)
            );
            setSession({ ...active, applied: quantity });
            onApplied?.(key);
          }}
          onClose={close}
          className={className}
        />
      </Suspense>
    ) : undefined;

  return { open, close, panel, weighingProductId: active?.selection.product.id ?? null };
}
