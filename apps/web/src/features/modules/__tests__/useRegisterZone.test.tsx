import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  DEFAULT_REGISTER_ZONES,
  REGISTER_ZONE_IDS,
  type RegisterZoneId,
} from '@puntovivo/shared/register-zones';
import { VERTICAL_PRESET_IDS } from '@puntovivo/shared/vertical-presets';
import { AuthContext, type AuthContextType } from '@/features/auth/AuthContext';
import { __modulesStoreForTests } from '../ModulesContext';
import { CLIENT_MODULE_DEFAULTS } from '../manifest';
import { useRegisterZone } from '../useRegisterZone';

function zonesFor(settings: Record<string, unknown> | null): Record<RegisterZoneId, boolean> {
  const session = settings ? { tenant: { settings } } : null;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={session as unknown as AuthContextType}>
      {children}
    </AuthContext.Provider>
  );
  const { result } = renderHook(
    () => Object.fromEntries(REGISTER_ZONE_IDS.map(id => [id, useRegisterZone(id)])),
    { wrapper }
  );
  return result.current as Record<RegisterZoneId, boolean>;
}

function setModules(overrides: Partial<typeof CLIENT_MODULE_DEFAULTS>) {
  __modulesStoreForTests.setState({ modules: { ...CLIENT_MODULE_DEFAULTS, ...overrides } });
}

describe('useRegisterZone', () => {
  beforeEach(() => setModules({ quotations: true, 'dine-in': true }));

  it.each(VERTICAL_PRESET_IDS)('renders the %s matrix', businessType => {
    expect(zonesFor({ businessType })).toEqual(DEFAULT_REGISTER_ZONES[businessType]);
  });

  it('keeps every zone without a profile or a session', () => {
    expect(Object.values(zonesFor({ taxRate: 19 })).every(Boolean)).toBe(true);
    expect(Object.values(zonesFor(null)).every(Boolean)).toBe(true);
  });

  it('applies the tenant override on top of the profile', () => {
    const zones = zonesFor({
      businessType: 'retail',
      registerZones: { 'units-cut': true, 'pharmacy-lot': true, 'quick-keys': false },
    });
    expect(zones['units-cut']).toBe(true);
    expect(zones['pharmacy-lot']).toBe(true);
    expect(zones['quick-keys']).toBe(false);
  });

  it('hides a zone while the module it needs is off', () => {
    setModules({ quotations: false, 'dine-in': false });
    expect(zonesFor({ businessType: 'hardware' })['quote-delivery']).toBe(false);
    expect(zonesFor({ businessType: 'restaurant' }).tables).toBe(false);
    expect(zonesFor({ businessType: 'hardware' })['units-cut']).toBe(true);
  });
});
