import { isVerticalPresetId, type VerticalPresetId } from './vertical-presets.ts';

/** Module ids a zone needs on top of its own switch. Modules stay the gate for surfaces. */
export type RegisterZoneModuleId = 'dine-in' | 'quotations';

interface ZoneTraits {
  /** The selling engine every profile shares; never switched off. */
  locked?: true;
  /** The register has no control for the zone yet, so a switch would do nothing. */
  unavailable?: true;
  requiresModule?: RegisterZoneModuleId;
}

/** Zones of the register, in the order the profile matrix lists them. */
const ZONE_TRAITS = {
  'command-bar': { locked: true },
  'quick-keys': {},
  'weight-value': {},
  credit: {},
  'promos-parked': {},
  'pharmacy-lot': { unavailable: true },
  'units-cut': { unavailable: true },
  'quote-delivery': { unavailable: true, requiresModule: 'quotations' },
  tables: { requiresModule: 'dine-in' },
  'tip-split': {},
  checkout: { locked: true },
} as const satisfies Record<string, ZoneTraits>;

export type RegisterZoneId = keyof typeof ZONE_TRAITS;
export type RegisterZoneMap = Record<RegisterZoneId, boolean>;
export type RegisterZoneOverrides = Partial<RegisterZoneMap>;

export interface RegisterZoneDescriptor {
  id: RegisterZoneId;
  locked: boolean;
  /** Admins can switch it: not part of the engine and the register has a control for it. */
  switchable: boolean;
  requiresModule: RegisterZoneModuleId | null;
}

export const REGISTER_ZONES: readonly RegisterZoneDescriptor[] = Object.entries(ZONE_TRAITS).map(
  ([id, traits]: [string, ZoneTraits]) => ({
    id: id as RegisterZoneId,
    locked: traits.locked === true,
    switchable: !traits.locked && !traits.unavailable,
    requiresModule: traits.requiresModule ?? null,
  })
);

export const REGISTER_ZONE_IDS = REGISTER_ZONES.map(zone => zone.id);

const DESCRIPTORS = Object.fromEntries(REGISTER_ZONES.map(zone => [zone.id, zone])) as Record<
  RegisterZoneId,
  RegisterZoneDescriptor
>;

export function registerZoneDescriptor(id: RegisterZoneId): RegisterZoneDescriptor {
  return DESCRIPTORS[id];
}

/** Zones an admin can switch today. */
export const SWITCHABLE_REGISTER_ZONE_IDS = REGISTER_ZONE_IDS.filter(
  id => DESCRIPTORS[id].switchable
) as [RegisterZoneId, ...RegisterZoneId[]];

const on = (...ids: RegisterZoneId[]): RegisterZoneMap =>
  Object.fromEntries(
    REGISTER_ZONE_IDS.map(id => [id, DESCRIPTORS[id].locked || ids.includes(id)])
  ) as RegisterZoneMap;

/**
 * The default matrix per business profile, keyed in the design matrix's column
 * order. Retail covers both the corner store and the minimarket, so it carries
 * the union of their zones.
 */
export const DEFAULT_REGISTER_ZONES: Record<VerticalPresetId, RegisterZoneMap> = {
  retail: on('quick-keys', 'weight-value', 'credit', 'promos-parked'),
  pharmacy: on('promos-parked', 'pharmacy-lot'),
  hardware: on('credit', 'promos-parked', 'units-cut', 'quote-delivery'),
  restaurant: on('quick-keys', 'tables', 'tip-split'),
  quickservice: on('quick-keys', 'tip-split'),
  wholesale: on('credit', 'promos-parked', 'units-cut', 'quote-delivery'),
  butchery: on('quick-keys', 'weight-value', 'credit', 'promos-parked'),
};

/** Without a profile the register keeps every zone, as it did before profiles existed. */
const NO_PROFILE_ZONES: RegisterZoneMap = on(...REGISTER_ZONE_IDS);

export function defaultRegisterZones(businessType: unknown): RegisterZoneMap {
  return isVerticalPresetId(businessType) ? DEFAULT_REGISTER_ZONES[businessType] : NO_PROFILE_ZONES;
}

function overrideOf(overrides: unknown, id: RegisterZoneId): boolean | undefined {
  if (typeof overrides !== 'object' || overrides === null || !DESCRIPTORS[id].switchable) {
    return undefined;
  }
  const value = (overrides as Record<string, unknown>)[id];
  return typeof value === 'boolean' ? value : undefined;
}

/** Keep only well-formed overrides of switchable zones from an untyped settings blob. */
export function sanitizeRegisterZoneOverrides(value: unknown): RegisterZoneOverrides {
  if (Array.isArray(value)) return {};
  const overrides: RegisterZoneOverrides = {};
  for (const id of SWITCHABLE_REGISTER_ZONE_IDS) {
    const override = overrideOf(value, id);
    if (override !== undefined) overrides[id] = override;
  }
  return overrides;
}

/** One zone from the profile default and the tenant's override, before module gates. */
export function resolveRegisterZone(
  businessType: unknown,
  overrides: unknown,
  id: RegisterZoneId
): boolean {
  return (
    (Array.isArray(overrides) ? undefined : overrideOf(overrides, id)) ??
    defaultRegisterZones(businessType)[id]
  );
}

export function resolveRegisterZones(businessType: unknown, overrides: unknown): RegisterZoneMap {
  return Object.fromEntries(
    REGISTER_ZONE_IDS.map(id => [id, resolveRegisterZone(businessType, overrides, id)])
  ) as RegisterZoneMap;
}
