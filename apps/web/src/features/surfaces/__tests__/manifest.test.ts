/**
 * ENG-069 — Renderer-side surface manifest mirror tests.
 *
 * Pins parity with the server's `services/surfaces/manifest.ts`:
 *   - Same SURFACE_IDS tuple.
 *   - Same moduleId for each non-default surface.
 *   - POS Desktop is the implicit default (moduleId === null).
 *   - i18nKey + defaultRoute uniqueness.
 */

import { describe, expect, it } from 'vitest';
import {
  CLIENT_SURFACE_IDS,
  CLIENT_SURFACES_MANIFEST,
  isClientSurfaceId,
} from '../manifest';

describe('CLIENT_SURFACES_MANIFEST (ENG-069)', () => {
  it('has 5 surfaces in v1 — POS Desktop + 4 new', () => {
    expect(CLIENT_SURFACE_IDS.length).toBe(5);
    expect(CLIENT_SURFACE_IDS).toEqual([
      'pos-desktop',
      'pos-touch',
      'kds',
      'customer-display',
      'mobile-waiter',
    ]);
  });

  it('every SURFACE_IDS entry has a matching descriptor', () => {
    for (const id of CLIENT_SURFACE_IDS) {
      const descriptor = CLIENT_SURFACES_MANIFEST[id];
      expect(descriptor).toBeDefined();
      expect(descriptor.id).toBe(id);
    }
  });

  it('POS Desktop is the implicit default (moduleId=null)', () => {
    expect(CLIENT_SURFACES_MANIFEST['pos-desktop'].moduleId).toBeNull();
  });

  it('non-default surfaces map to their corresponding module id', () => {
    expect(CLIENT_SURFACES_MANIFEST['pos-touch'].moduleId).toBe('pos-touch');
    expect(CLIENT_SURFACES_MANIFEST['kds'].moduleId).toBe('kds');
    expect(CLIENT_SURFACES_MANIFEST['customer-display'].moduleId).toBe(
      'customer-display'
    );
    expect(CLIENT_SURFACES_MANIFEST['mobile-waiter'].moduleId).toBe(
      'mobile-waiter'
    );
  });

  it('defaultRoute is unique across surfaces', () => {
    const routes = CLIENT_SURFACE_IDS.map(
      id => CLIENT_SURFACES_MANIFEST[id].defaultRoute
    );
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('i18nKey is unique across surfaces', () => {
    const keys = CLIENT_SURFACE_IDS.map(id => CLIENT_SURFACES_MANIFEST[id].i18nKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isClientSurfaceId (ENG-069)', () => {
  it('returns true for every known id', () => {
    for (const id of CLIENT_SURFACE_IDS) {
      expect(isClientSurfaceId(id)).toBe(true);
    }
  });

  it('returns false for unknown ids', () => {
    expect(isClientSurfaceId('not-a-surface')).toBe(false);
    expect(isClientSurfaceId('POS-Desktop')).toBe(false); // case-sensitive
    expect(isClientSurfaceId('')).toBe(false);
  });
});
