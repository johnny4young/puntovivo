/**
 * Module manifest regression tests.
 *
 * Pins the contract every kernel consumer relies on:
 *
 * - `MODULE_IDS` + `MODULES_MANIFEST` stay exhaustively keyed.
 * - `resolveModulesState` is defensive in three directions:
 * missing / null input → defaults; unknown keys → dropped;
 * non-boolean values → ignored.
 * - `isModuleId` rejects garbage at the runtime boundary.
 * - `visibleDescriptors` scopes the admin tab by role.
 * - `buildModulesBlob` round-trips partial state into a complete map.
 */

import { describe, expect, it } from 'vitest';
import {
  MODULE_IDS,
  MODULES_MANIFEST,
  MODULES_SCHEMA_VERSION,
  buildModulesBlob,
  isModuleActiveInSettings,
  isModuleId,
  resolveModulesState,
  visibleDescriptors,
  type ModuleId,
} from '../services/modules/manifest.js';

describe('module manifest exhaustiveness', () => {
  it('every MODULE_IDS entry has a matching descriptor', () => {
    for (const id of MODULE_IDS) {
      expect(MODULES_MANIFEST[id]).toBeDefined();
      expect(MODULES_MANIFEST[id]?.id).toBe(id);
    }
  });

  it('every descriptor key matches its id (no copy-paste typos)', () => {
    for (const [key, descriptor] of Object.entries(MODULES_MANIFEST)) {
      expect(descriptor.id).toBe(key);
    }
  });

  it('every descriptor declares a non-empty i18nKey', () => {
    for (const id of MODULE_IDS) {
      expect(MODULES_MANIFEST[id].i18nKey).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
    }
  });

  it('schema version is positive integer', () => {
    expect(MODULES_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('locks the v1 +  surfaces +  events +  delivery module set so deletions trigger CI failure', () => {
    // Pin the count so a silent removal of a module from the list
    // is caught by the regression test before it lands. The 5 demo
    // modules from  default ON; the 4 surface modules from
    // default OFF; the events-api module from  also
    // default OFF; the delivery module from  also defaults
    // OFF (each new surface or integration is opt-in per tenant).
    expect(MODULE_IDS.length).toBe(11);
    expect(MODULE_IDS).toEqual([
      'copilot',
      'operations-center',
      'quotations',
      'anomaly-detection',
      'semantic-search',
      'pos-touch',
      'kds',
      'customer-display',
      'mobile-waiter',
      'events-api',
      'delivery',
    ]);
  });

  it(' demo modules default ON;  surfaces +  events +  delivery default OFF', () => {
    const onByDefault = MODULE_IDS.filter(id => MODULES_MANIFEST[id].defaultEnabled === true);
    const offByDefault = MODULE_IDS.filter(id => MODULES_MANIFEST[id].defaultEnabled === false);
    expect(onByDefault).toEqual([
      'copilot',
      'operations-center',
      'quotations',
      'anomaly-detection',
      'semantic-search',
    ]);
    expect(offByDefault).toEqual([
      'pos-touch',
      'kds',
      'customer-display',
      'mobile-waiter',
      'events-api',
      'delivery',
    ]);
  });
});

describe('isModuleId', () => {
  it('returns true for every known id', () => {
    for (const id of MODULE_IDS) {
      expect(isModuleId(id)).toBe(true);
    }
  });

  it('returns false for an unknown id', () => {
    expect(isModuleId('not-a-module')).toBe(false);
    expect(isModuleId('Copilot')).toBe(false); // case-sensitive
    expect(isModuleId('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isModuleId(undefined)).toBe(false);
    expect(isModuleId(null)).toBe(false);
    expect(isModuleId(42)).toBe(false);
    expect(isModuleId({ id: 'copilot' })).toBe(false);
  });
});

describe('resolveModulesState', () => {
  it('returns every module at its default state when raw is null', () => {
    const state = resolveModulesState(null);
    for (const id of MODULE_IDS) {
      expect(state[id]).toBe(MODULES_MANIFEST[id].defaultEnabled);
    }
  });

  it('returns every module at its default state when raw is undefined', () => {
    const state = resolveModulesState(undefined);
    for (const id of MODULE_IDS) {
      expect(state[id]).toBe(MODULES_MANIFEST[id].defaultEnabled);
    }
  });

  it('returns defaults when raw is an empty object', () => {
    const state = resolveModulesState({});
    for (const id of MODULE_IDS) {
      expect(state[id]).toBe(MODULES_MANIFEST[id].defaultEnabled);
    }
  });

  it('honors explicit boolean values', () => {
    const state = resolveModulesState({
      copilot: false,
      'operations-center': true,
    });
    expect(state.copilot).toBe(false);
    expect(state['operations-center']).toBe(true);
    // Unset modules fall back to defaults.
    expect(state.quotations).toBe(MODULES_MANIFEST.quotations.defaultEnabled);
  });

  it('drops unknown keys silently (forwards-compat for stale toggles)', () => {
    const state = resolveModulesState({
      copilot: false,
      'future-module-id': true,
      'random-junk': false,
    });
    expect(state.copilot).toBe(false);
    expect(Object.keys(state)).toEqual([...MODULE_IDS]);
    // No reference to the unknown key in the output.
    expect((state as Record<string, unknown>)['future-module-id']).toBeUndefined();
  });

  it('falls back to default when value is non-boolean', () => {
    const state = resolveModulesState({
      copilot: 'yes', // string instead of bool
      'operations-center': 1, // number instead of bool
      quotations: null, // null instead of bool
    });
    expect(state.copilot).toBe(MODULES_MANIFEST.copilot.defaultEnabled);
    expect(state['operations-center']).toBe(MODULES_MANIFEST['operations-center'].defaultEnabled);
    expect(state.quotations).toBe(MODULES_MANIFEST.quotations.defaultEnabled);
  });

  it('rejects array input gracefully', () => {
    const state = resolveModulesState([true, false]);
    for (const id of MODULE_IDS) {
      expect(state[id]).toBe(MODULES_MANIFEST[id].defaultEnabled);
    }
  });

  it('always returns a complete map keyed on every known module', () => {
    const state = resolveModulesState({ copilot: true });
    for (const id of MODULE_IDS) {
      expect(state).toHaveProperty(id);
    }
  });
});

describe('visibleDescriptors', () => {
  it('admin sees every admin-visible module', () => {
    const visible = visibleDescriptors('admin').map(d => d.id);
    // Today every demo module is admin-only.
    expect(visible).toEqual([...MODULE_IDS]);
  });

  it('manager sees zero modules today (all are admin-only)', () => {
    const visible = visibleDescriptors('manager').map(d => d.id);
    expect(visible).toEqual([]);
  });

  it('cashier sees zero modules today', () => {
    const visible = visibleDescriptors('cashier').map(d => d.id);
    expect(visible).toEqual([]);
  });

  it('viewer sees zero modules today', () => {
    const visible = visibleDescriptors('viewer').map(d => d.id);
    expect(visible).toEqual([]);
  });
});

describe('buildModulesBlob', () => {
  it('fills missing keys with defaults', () => {
    const blob = buildModulesBlob({ copilot: false });
    expect(blob.copilot).toBe(false);
    expect(blob['operations-center']).toBe(MODULES_MANIFEST['operations-center'].defaultEnabled);
    expect(Object.keys(blob).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('honors all explicit values', () => {
    const partial: Partial<Record<ModuleId, boolean>> = {
      copilot: false,
      'operations-center': false,
      quotations: false,
      'anomaly-detection': false,
      'semantic-search': false,
    };
    const blob = buildModulesBlob(partial);
    for (const id of MODULE_IDS) {
      expect(blob[id]).toBe(false);
    }
  });

  it('returns defaults for an empty partial', () => {
    const blob = buildModulesBlob({});
    for (const id of MODULE_IDS) {
      expect(blob[id]).toBe(MODULES_MANIFEST[id].defaultEnabled);
    }
  });
});

describe('isModuleActiveInSettings', () => {
  it('returns the manifest default for null / undefined settings', () => {
    expect(isModuleActiveInSettings(null, 'events-api')).toBe(false);
    expect(isModuleActiveInSettings(undefined, 'events-api')).toBe(false);
    expect(isModuleActiveInSettings(null, 'copilot')).toBe(true);
  });

  it('returns the explicit boolean when the blob carries one', () => {
    expect(isModuleActiveInSettings({ modules: { 'events-api': true } }, 'events-api')).toBe(true);
    expect(isModuleActiveInSettings({ modules: { 'events-api': false } }, 'events-api')).toBe(
      false
    );
  });

  it('falls back to default when modules key is missing or non-object', () => {
    expect(isModuleActiveInSettings({ otherKey: 1 }, 'events-api')).toBe(false);
    expect(isModuleActiveInSettings({ modules: 'oops' }, 'events-api')).toBe(false);
  });

  it('falls back to default when the module entry is non-boolean', () => {
    expect(
      isModuleActiveInSettings(
        { modules: { 'events-api': 'true' /* string, not bool */ } },
        'events-api'
      )
    ).toBe(false);
  });

  it('respects each module independently', () => {
    const settings = {
      modules: {
        copilot: false,
        'events-api': true,
      },
    };
    expect(isModuleActiveInSettings(settings, 'copilot')).toBe(false);
    expect(isModuleActiveInSettings(settings, 'events-api')).toBe(true);
    // Default for an untouched module.
    expect(isModuleActiveInSettings(settings, 'quotations')).toBe(true);
  });
});
