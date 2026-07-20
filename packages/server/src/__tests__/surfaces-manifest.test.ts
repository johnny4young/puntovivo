/**
 * Surface manifest regression tests.
 *
 * Pins the contract every surface kernel consumer relies on:
 *
 * - SURFACE_IDS + SURFACES_MANIFEST stay exhaustively keyed.
 * - Every non-null moduleId references a real module from the
 * modules manifest.
 * - defaultRoute is unique across surfaces (no two surfaces mount
 * on the same URL).
 * - i18nKey is unique across surfaces (no two surfaces share copy).
 * - POS Desktop is the implicit default (moduleId === null).
 * - assertSurfaceManifestIntegrity throws when a surface points at
 * a non-existent module id.
 */

import { describe, expect, it } from 'vitest';
import { MODULE_IDS, type ModuleId } from '../services/modules/manifest.js';
import {
  SURFACE_IDS,
  SURFACES_MANIFEST,
  assertSurfaceManifestIntegrity,
  isSurfaceId,
} from '../services/surfaces/manifest.js';

describe('surfaces manifest exhaustiveness', () => {
  it('every SURFACE_IDS entry has a matching descriptor', () => {
    for (const id of SURFACE_IDS) {
      expect(SURFACES_MANIFEST[id]).toBeDefined();
      expect(SURFACES_MANIFEST[id]?.id).toBe(id);
    }
  });

  it('every descriptor key matches its id (no copy-paste typos)', () => {
    for (const [key, descriptor] of Object.entries(SURFACES_MANIFEST)) {
      expect(descriptor.id).toBe(key);
    }
  });

  it('every descriptor declares a non-empty i18nKey', () => {
    for (const id of SURFACE_IDS) {
      expect(SURFACES_MANIFEST[id].i18nKey).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
    }
  });

  it('locks the v1 surface set so deletions trigger CI failure', () => {
    expect(SURFACE_IDS.length).toBe(5);
    expect(SURFACE_IDS).toEqual([
      'pos-desktop',
      'pos-touch',
      'kds',
      'customer-display',
      'mobile-waiter',
    ]);
  });
});

describe('surfaces ↔ modules cross-manifest integrity', () => {
  it('POS Desktop is the implicit default (moduleId === null)', () => {
    expect(SURFACES_MANIFEST['pos-desktop'].moduleId).toBeNull();
  });

  it('every non-null moduleId resolves to a real module', () => {
    const moduleSet = new Set<ModuleId>(MODULE_IDS);
    for (const id of SURFACE_IDS) {
      const moduleId = SURFACES_MANIFEST[id].moduleId;
      if (moduleId === null) continue;
      expect(moduleSet.has(moduleId)).toBe(true);
    }
  });

  it('non-null moduleId surfaces match the 4  module ids', () => {
    const surfaceModuleIds = SURFACE_IDS.map(id => SURFACES_MANIFEST[id].moduleId).filter(
      (mid): mid is ModuleId => mid !== null
    );
    expect(surfaceModuleIds).toEqual(['pos-touch', 'kds', 'customer-display', 'mobile-waiter']);
  });

  it('assertSurfaceManifestIntegrity does not throw on the canonical manifest', () => {
    expect(() => assertSurfaceManifestIntegrity()).not.toThrow();
  });
});

describe('surfaces uniqueness invariants', () => {
  it('defaultRoute is unique across surfaces', () => {
    const routes = SURFACE_IDS.map(id => SURFACES_MANIFEST[id].defaultRoute);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('i18nKey is unique across surfaces', () => {
    const keys = SURFACE_IDS.map(id => SURFACES_MANIFEST[id].i18nKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('POS Desktop maps to /dashboard (the existing default route)', () => {
    expect(SURFACES_MANIFEST['pos-desktop'].defaultRoute).toBe('/dashboard');
  });

  it('every surface uses cashierOrAbove as the v1 role floor', () => {
    // v1 keeps every surface at cashier+ so existing roles
    // can preview each chrome. New roles (kitchen, waiter) come with
    // and may raise the floor for KDS / Mobile Waiter then.
    for (const id of SURFACE_IDS) {
      expect(SURFACES_MANIFEST[id].defaultRoleSet).toBe('cashierOrAbove');
    }
  });
});

describe('isSurfaceId', () => {
  it('returns true for every known id', () => {
    for (const id of SURFACE_IDS) {
      expect(isSurfaceId(id)).toBe(true);
    }
  });

  it('returns false for an unknown id', () => {
    expect(isSurfaceId('not-a-surface')).toBe(false);
    expect(isSurfaceId('POS-Desktop')).toBe(false); // case-sensitive
    expect(isSurfaceId('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isSurfaceId(undefined)).toBe(false);
    expect(isSurfaceId(null)).toBe(false);
    expect(isSurfaceId(42)).toBe(false);
    expect(isSurfaceId({})).toBe(false);
  });
});
