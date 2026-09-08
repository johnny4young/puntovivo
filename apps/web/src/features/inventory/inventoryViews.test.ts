/**
 * Role visibility of the inventory tabs.
 *
 * Every count and replenishment procedure behind the `controls` tab is a
 * managerOrAdmin one. Rendering the tab for a cashier offers a screen that can
 * only answer with authorization errors, so the tab list and the active view
 * both have to agree with the actor's role -- including after a role change
 * under an already-open page, which is a shift handover on a shared terminal.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAllowedInventoryView,
  viewKeys,
  visibleInventoryViews,
  type InventoryView,
} from './inventoryViews';

const ALL = Object.keys(viewKeys) as InventoryView[];
const FULL_ACCESS = { canManage: true, showPharmacy: true } as const;

describe('visibleInventoryViews', () => {
  it('gives a manager with pharmacy every tab, in declaration order', () => {
    expect(visibleInventoryViews(FULL_ACCESS)).toEqual(ALL);
  });

  it('hides the manager-only controls tab from a cashier', () => {
    const visible = visibleInventoryViews({ canManage: false, showPharmacy: true });
    expect(visible).not.toContain('controls');
    // Nothing else may disappear with it.
    expect(visible).toEqual(ALL.filter(view => view !== 'controls'));
  });

  it('hides the pharmacy tab from a tenant that does not operate one', () => {
    const visible = visibleInventoryViews({ canManage: true, showPharmacy: false });
    expect(visible).not.toContain('pharmacy');
    expect(visible).toEqual(ALL.filter(view => view !== 'pharmacy'));
  });

  it('applies both rules at once rather than letting one mask the other', () => {
    const visible = visibleInventoryViews({ canManage: false, showPharmacy: false });
    expect(visible).toEqual(ALL.filter(view => view !== 'controls' && view !== 'pharmacy'));
  });
});

describe('resolveAllowedInventoryView', () => {
  it('keeps a view the actor may open', () => {
    for (const view of ALL) {
      expect(resolveAllowedInventoryView(view, FULL_ACCESS)).toBe(view);
    }
    expect(resolveAllowedInventoryView('stock', { canManage: false, showPharmacy: false })).toBe(
      'stock'
    );
  });

  it('falls back when the actor loses access to the open view', () => {
    // The handover case: the panel was open as a manager, the cashier signs
    // in, and the page must not stay on a screen that now only errors.
    expect(resolveAllowedInventoryView('controls', { canManage: false, showPharmacy: true })).toBe(
      'movements'
    );
  });

  it('falls back when the pharmacy context resolves to unavailable', () => {
    // The tab can disappear after first paint, once the pharmacy context
    // query answers. A stored selection would strand the operator on it.
    expect(resolveAllowedInventoryView('pharmacy', { canManage: true, showPharmacy: false })).toBe(
      'movements'
    );
  });
});
