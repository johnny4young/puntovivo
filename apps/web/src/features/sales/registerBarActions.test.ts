import { describe, expect, it, vi } from 'vitest';
import { buildRegisterBarActions } from './registerBarActions';

describe('buildRegisterBarActions', () => {
  it('lists only the actions that have a handler, in register order', () => {
    const actions = buildRegisterBarActions({
      charge: vi.fn(),
      newSale: vi.fn(),
      suspend: vi.fn(),
      openDrawer: undefined,
    });
    expect(actions.map(action => action.id)).toEqual(['suspend', 'newSale', 'charge']);
  });

  it('carries the label key, the shortcut and the handler', () => {
    const suspend = vi.fn();
    const [action] = buildRegisterBarActions({ suspend });
    expect(action).toMatchObject({
      labelKey: 'commandBar.actions.suspend',
      shortcutId: 'sales.suspend',
    });
    action!.run();
    expect(suspend).toHaveBeenCalledOnce();
  });

  it('has no shortcut for actions without a key', () => {
    const [action] = buildRegisterBarActions({ returns: vi.fn() });
    expect(action?.shortcutId).toBeNull();
  });
});
