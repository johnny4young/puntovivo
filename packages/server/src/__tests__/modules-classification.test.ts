/**
 * ENG-183 — Module classification + Ring-1 retail profile invariants.
 *
 * Guards the product-scope contract that the runtime now enforces:
 *   - every module is classified (core / compliance / optional / experimental)
 *     and assigned a market ring;
 *   - the Ring-1 retail profile written for a fresh tenant covers every module
 *     id and enables ONLY the core (Ring-1 sellability) modules, so a fresh
 *     retail tenant never lands on restaurant / delivery / public-API / AI
 *     surfaces.
 */

import { describe, expect, it } from 'vitest';
import {
  MODULE_IDS,
  MODULES_MANIFEST,
  RING1_RETAIL_PROFILE,
  type ModuleClassification,
  type ModuleId,
} from '../services/modules/manifest.js';

const CLASSIFICATIONS: readonly ModuleClassification[] = [
  'core',
  'compliance',
  'optional',
  'experimental',
];

describe('module classification (ENG-183)', () => {
  it('classifies every module with a valid class and ring', () => {
    for (const id of MODULE_IDS) {
      const descriptor = MODULES_MANIFEST[id];
      expect(CLASSIFICATIONS).toContain(descriptor.classification);
      expect([1, 2, 3]).toContain(descriptor.ring);
    }
  });

  it('exposes operations-center + quotations as the only Ring-1 core modules', () => {
    const core = MODULE_IDS.filter(id => MODULES_MANIFEST[id].classification === 'core');
    expect([...core].sort()).toEqual(['operations-center', 'quotations']);
  });
});

describe('RING1_RETAIL_PROFILE (ENG-183)', () => {
  it('covers every known module id with an explicit boolean', () => {
    expect(Object.keys(RING1_RETAIL_PROFILE).sort()).toEqual([...MODULE_IDS].sort());
    for (const id of MODULE_IDS) {
      expect(typeof RING1_RETAIL_PROFILE[id]).toBe('boolean');
    }
  });

  it('enables only the core modules (a fresh retail tenant sees the Ring-1 core)', () => {
    const enabled = MODULE_IDS.filter(id => RING1_RETAIL_PROFILE[id]);
    expect([...enabled].sort()).toEqual(['operations-center', 'quotations']);
    for (const id of MODULE_IDS) {
      expect(RING1_RETAIL_PROFILE[id]).toBe(MODULES_MANIFEST[id].classification === 'core');
    }
  });

  it('hides restaurant / delivery / public-API / AI surfaces for a fresh retail tenant', () => {
    const hidden: ModuleId[] = [
      'copilot',
      'anomaly-detection',
      'semantic-search',
      'pos-touch',
      'kds',
      'customer-display',
      'mobile-waiter',
      'events-api',
      'delivery',
    ];
    for (const id of hidden) {
      expect(RING1_RETAIL_PROFILE[id]).toBe(false);
    }
  });
});
