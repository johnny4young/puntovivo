/**
 * A-30 — vertical module presets.
 *
 * New tenants land in a POS that shows every surface module the kernel
 * knows about, so a corner store sees KDS and mobile-waiter it will never
 * touch. A preset is the one-click baseline for a business type: it flips
 * the SURFACE modules to a sensible shape (a shop hides the restaurant
 * surfaces; a restaurant turns them on) and leaves everything else exactly
 * as the operator had it.
 *
 * The load-bearing rule: a preset is a PARTIAL map. It only opines on the
 * modules that distinguish one vertical from another — the register
 * surfaces plus the two B2B/ops modules. It deliberately says NOTHING about
 * the AI modules (copilot, anomaly-detection, semantic-search) or events-api:
 * those cost money or a key and the operator's choice there must survive a
 * preset. Applying a preset json_sets only its own keys.
 *
 * Pure module (no DB, no tRPC) so the renderer can preview a preset and the
 * server can apply it from the same source. Mirrors the manifest's posture.
 *
 * @module services/modules/presets
 */

import { MODULE_IDS, type ModuleId } from './manifest.js';

/** The closed set of vertical presets the UI offers. */
export const VERTICAL_PRESET_IDS = ['retail', 'restaurant', 'quickservice', 'wholesale'] as const;

export type VerticalPresetId = (typeof VERTICAL_PRESET_IDS)[number];

/**
 * The subset of modules a preset is allowed to touch. Everything outside
 * this set (the AI trio + events-api) is off-limits to presets by design —
 * see the module docstring. Kept as a runtime constant so the guard below
 * can reject a hand-forged patch that reaches past it.
 */
export const PRESET_SCOPED_MODULES = [
  'operations-center',
  'quotations',
  'pos-touch',
  'kds',
  'customer-display',
  'mobile-waiter',
  'delivery',
] as const satisfies readonly ModuleId[];

const SCOPED = new Set<ModuleId>(PRESET_SCOPED_MODULES);

/**
 * A preset patch: the modules this vertical opines on and the state it
 * wants them in. Partial by contract — absent keys are left untouched.
 */
export type PresetPatch = Partial<Record<ModuleId, boolean>>;

/**
 * The presets. Each lists ONLY scoped modules. The AI modules and
 * events-api never appear here.
 */
export const VERTICAL_PRESETS: Record<VerticalPresetId, PresetPatch> = {
  // Tienda / minimarket / droguería: mostrador con POS de escritorio. Sin
  // superficies de restaurante; el centro de operaciones ON para ver la
  // salud de varias sedes. FEFO/lotes/vencimientos NO son módulos — están
  // siempre disponibles, así que la droguería no necesita nada extra aquí.
  retail: {
    'operations-center': true,
    quotations: false,
    'pos-touch': false,
    kds: false,
    'customer-display': false,
    'mobile-waiter': false,
    delivery: false,
  },
  // Restaurante con mesas: todas las superficies de servicio en mesa.
  restaurant: {
    'operations-center': true,
    'pos-touch': true,
    kds: true,
    'customer-display': true,
    'mobile-waiter': true,
  },
  // Comida rápida / cafetería: pantalla táctil + cocina + pantalla al
  // cliente, sin mesas ni mesero móvil.
  quickservice: {
    'operations-center': true,
    'pos-touch': true,
    kds: true,
    'customer-display': true,
    'mobile-waiter': false,
    delivery: false,
  },
  // Mayorista / distribuidor: cotizaciones B2B + centro de operaciones,
  // sin superficies de restaurante.
  wholesale: {
    'operations-center': true,
    quotations: true,
    'pos-touch': false,
    kds: false,
    'customer-display': false,
    'mobile-waiter': false,
  },
};

/**
 * Resolve a preset id to its patch, validated to touch only scoped
 * modules. Throws on an unknown id or a patch that reaches an off-limits
 * module — both are programmer errors the manifest/preset pair should
 * never produce, pinned by the test.
 */
export function resolvePresetPatch(presetId: VerticalPresetId): PresetPatch {
  const patch = VERTICAL_PRESETS[presetId];
  if (!patch) {
    throw new Error(`unknown vertical preset: ${presetId}`);
  }
  for (const key of Object.keys(patch) as ModuleId[]) {
    if (!MODULE_IDS.includes(key)) {
      throw new Error(`preset "${presetId}" references unknown module "${key}"`);
    }
    if (!SCOPED.has(key)) {
      throw new Error(
        `preset "${presetId}" touches "${key}", which is outside PRESET_SCOPED_MODULES`
      );
    }
  }
  return patch;
}
