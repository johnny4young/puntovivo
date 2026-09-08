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

describe('visibleInventoryViews', () => {
  it('gives a manager every tab, in declaration order', () => {
    expect(visibleInventoryViews(true)).toEqual(ALL);
  });

  it('hides the manager-only controls tab from a cashier', () => {
    const visible = visibleInventoryViews(false);
    expect(visible).not.toContain('controls');
    // Nothing else may disappear with it.
    expect(visible).toEqual(ALL.filter(view => view !== 'controls'));
  });
});

describe('resolveAllowedInventoryView', () => {
  it('keeps a view the actor may open', () => {
    for (const view of ALL) {
      expect(resolveAllowedInventoryView(view, true)).toBe(view);
    }
    expect(resolveAllowedInventoryView('stock', false)).toBe('stock');
  });

  it('falls back when the actor loses access to the open view', () => {
    // The handover case: the panel was open as a manager, the cashier signs
    // in, and the page must not stay on a screen that now only errors.
    expect(resolveAllowedInventoryView('controls', false)).toBe('movements');
  });
});
