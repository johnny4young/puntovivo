import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSaleDelivery } from './useSaleDelivery';
import { useCartWorkspaceStore } from './useCartWorkspaceStore';
import type { CompletedSaleSummary } from './SaleCompleteStrip';

const gates = vi.hoisted(() => ({ zone: true, module: true }));
vi.mock('@/features/modules/useRegisterZone', () => ({ useRegisterZone: () => gates.zone }));
vi.mock('@/features/modules', () => ({ useIsModuleActive: () => gates.module }));

const SALE: CompletedSaleSummary = { id: 'sale-1', saleNumber: 'VTA-1', total: 840_985, change: 0 };

type Args = Parameters<typeof useSaleDelivery>[0];
function renderDelivery(initial: Partial<Args> = {}) {
  return renderHook(
    (args: Args) => {
      const workspace = useCartWorkspaceStore(state =>
        state.activeId ? state.workspaces[state.activeId] : null
      );
      return useSaleDelivery({ ...args, activeWorkspace: workspace ?? null });
    },
    {
      initialProps: {
        activeWorkspace: null,
        hasItems: true,
        completedSale: null,
        hasCashSession: true,
        userRole: 'cashier',
        ...initial,
      },
    }
  );
}

describe('useSaleDelivery', () => {
  beforeEach(() => {
    gates.zone = true;
    gates.module = true;
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    useCartWorkspaceStore.getState().createDraft('tenant-1:user-1');
  });

  it('marks the ticket and toggles the mark back off', () => {
    const { result } = renderDelivery();
    expect(result.current.active).toBe(false);
    act(() => result.current.onKey!());
    expect(result.current.active).toBe(true);
    const { activeId, workspaces } = useCartWorkspaceStore.getState();
    expect(workspaces[activeId!]?.deliveryRequested).toBe(true);
    act(() => result.current.onKey!());
    expect(result.current.active).toBe(false);
  });

  it('opens the sheet only for a sale whose ticket was marked', () => {
    const { result } = renderDelivery();
    act(() => result.current.onSaleCompleted(SALE));
    expect(result.current.sale).toBeNull();
    act(() => result.current.onSaleCompleted({ ...SALE, deliveryRequested: true }));
    expect(result.current.sale).toMatchObject({ id: 'sale-1' });
  });

  it('sends the sale just charged from an empty ticket, once', () => {
    const { result } = renderDelivery({ hasItems: false, completedSale: SALE });
    act(() => result.current.onKey!());
    expect(result.current.sale).toEqual(SALE);
    act(() => result.current.close(true));
    expect(result.current.sale).toBeNull();
    expect(result.current.onKey).toBeUndefined();
  });

  it('keeps the key for a sale whose sheet was dismissed', () => {
    const { result } = renderDelivery({ hasItems: false, completedSale: SALE });
    act(() => result.current.onKey!());
    act(() => result.current.close(false));
    expect(result.current.onKey).toBeDefined();
  });

  it('hides the key without the zone, the delivery module, a register or a sales role', () => {
    expect(renderDelivery({ hasCashSession: false }).result.current.shown).toBe(false);
    expect(renderDelivery({ userRole: 'viewer' }).result.current.shown).toBe(false);
    gates.module = false;
    expect(renderDelivery().result.current.shown).toBe(false);
    gates.module = true;
    gates.zone = false;
    const { result } = renderDelivery();
    expect(result.current.shown).toBe(false);
    expect(result.current.onKey).toBeUndefined();
  });

  it('has nothing to do with an empty ticket and no sale on the strip', () => {
    expect(renderDelivery({ hasItems: false }).result.current.onKey).toBeUndefined();
  });
});
