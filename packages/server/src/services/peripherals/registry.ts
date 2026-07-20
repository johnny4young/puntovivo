/**
 * Peripheral adapter registry.
 *
 * Strategy/Factory mirroring `services/fiscal/registry.ts`. Resolves
 * the active row in `site_peripherals` by `(tenantId, siteId, kind)`
 * and dispatches by `driver` to the matching adapter constructor.
 *
 * ships two default drivers — `system` (printer) and
 * `manual` (payment_terminal). All other `(kind, driver)` pairs
 * surface `PERIPHERAL_DRIVER_NOT_IMPLEMENTED` via
 * `peripheralsRouter.test`;  add new drivers by
 * extending the dispatcher.
 *
 * Returns `null` (not throws) when no active peripheral is configured
 * for the requested kind — sales code keeps working without
 * registration.
 *
 * @module services/peripherals/registry
 */

import { and, eq } from 'drizzle-orm';
import type { ZodSchema } from 'zod';
import type { DatabaseInstance } from '../../db/index.js';
import {
  peripheralKindEnum,
  sitePeripherals,
  type PeripheralKind,
  type SitePeripheralRow,
} from '../../db/schema.js';
import type { BasePeripheralAdapter } from './types.js';
import {
  SystemReceiptPrinterAdapter,
  systemReceiptPrinterConfigSchema,
} from './drivers/system-receipt-printer.js';
import {
  ManualPaymentTerminalAdapter,
  manualPaymentTerminalConfigSchema,
} from './drivers/manual-payment-terminal.js';
import {
  KeyboardWedgeScannerAdapter,
  wedgeScannerConfigSchema,
} from './drivers/keyboard-wedge-scanner.js';
import {
  EscPosReceiptPrinterAdapter,
  escposReceiptPrinterConfigSchema,
} from './drivers/escpos-receipt-printer.js';
import {
  EscPosCashDrawerAdapter,
  escposCashDrawerConfigSchema,
} from './drivers/escpos-cash-drawer.js';

/**
 * Static dispatch table: `kind → driverId → factory`. Each factory
 * receives the persisted row + parsed config and returns a typed
 * adapter instance. Adding a driver in  = drop a new
 * (kind, driverId) entry here without touching the registry plumbing
 * or the tRPC router.
 */
type DriverFactory = (
  ctx: AdapterFactoryArgs,
  rawConfig: Record<string, unknown>
) => BasePeripheralAdapter;

interface AdapterFactoryArgs {
  tenantId: string;
  siteId: string;
  peripheralId: string;
}

interface DriverRegistration {
  factory: DriverFactory;
  configSchema: ZodSchema<Record<string, unknown>>;
}

const DRIVER_TABLE: {
  [K in PeripheralKind]?: Record<string, DriverRegistration>;
} = {
  printer: {
    system: {
      factory: (ctx, rawConfig) => {
        const config = systemReceiptPrinterConfigSchema.parse(rawConfig);
        return new SystemReceiptPrinterAdapter(ctx.tenantId, ctx.siteId, ctx.peripheralId, config);
      },
      configSchema: systemReceiptPrinterConfigSchema as unknown as ZodSchema<
        Record<string, unknown>
      >,
    },
    // ESC/POS thermal printer. Sends pre-built bytes to
    // a USB / TCP / serial / mock channel. USB + serial are stubs
    // that throw DRIVER_NOT_IMPLEMENTED until the native deps land
    // in a follow-up; mock + TCP are fully wired today.
    escpos: {
      factory: (ctx, rawConfig) => {
        const config = escposReceiptPrinterConfigSchema.parse(rawConfig);
        return new EscPosReceiptPrinterAdapter(ctx.tenantId, ctx.siteId, ctx.peripheralId, config);
      },
      configSchema: escposReceiptPrinterConfigSchema as unknown as ZodSchema<
        Record<string, unknown>
      >,
    },
  },
  payment_terminal: {
    manual: {
      factory: (ctx, rawConfig) => {
        const config = manualPaymentTerminalConfigSchema.parse(rawConfig);
        return new ManualPaymentTerminalAdapter(ctx.tenantId, ctx.siteId, ctx.peripheralId, config);
      },
      configSchema: manualPaymentTerminalConfigSchema as unknown as ZodSchema<
        Record<string, unknown>
      >,
    },
  },
  scanner: {
    // USB HID keyboard wedge. The renderer
    // (`useBarcodeWedgeListener`) does the keystroke capture; this
    // adapter is a typed identifier carrying the timing config.
    wedge: {
      factory: (ctx, rawConfig) => {
        const config = wedgeScannerConfigSchema.parse(rawConfig);
        return new KeyboardWedgeScannerAdapter(ctx.tenantId, ctx.siteId, ctx.peripheralId, config);
      },
      configSchema: wedgeScannerConfigSchema as unknown as ZodSchema<Record<string, unknown>>,
    },
  },
  cash_drawer: {
    // RJ11 cash drawer attached to an ESC/POS printer.
    // The drawer config slot mirrors the printer's transport shape;
    // operators typically point both at the same physical printer.
    escpos: {
      factory: (ctx, rawConfig) => {
        const config = escposCashDrawerConfigSchema.parse(rawConfig);
        return new EscPosCashDrawerAdapter(ctx.tenantId, ctx.siteId, ctx.peripheralId, config);
      },
      configSchema: escposCashDrawerConfigSchema as unknown as ZodSchema<Record<string, unknown>>,
    },
  },
  // customer_display: no drivers shipped yet.  lands
  // Bold/Wompi/MercadoPago payment terminals; customer_display
  // remains a follow-up once the operator has a concrete display
  // model to integrate.
};

/**
 * Discovery: which (kind, driverId) pairs the registry can dispatch
 * today. Used by the admin UI to populate the driver picker without
 * surfacing combinations that immediately fail validation.
 */
export function listSupportedDrivers(): Array<{
  kind: PeripheralKind;
  driverId: string;
}> {
  const out: Array<{ kind: PeripheralKind; driverId: string }> = [];
  for (const kind of peripheralKindEnum) {
    const drivers = DRIVER_TABLE[kind];
    if (!drivers) continue;
    for (const driverId of Object.keys(drivers)) {
      out.push({ kind, driverId });
    }
  }
  return out;
}

/**
 * Pre-validation hook used by the tRPC router before a register /
 * update mutation persists. Returns `null` when the (kind, driver)
 * pair is supported and the config parses cleanly; returns a stable
 * error code when something is off so the router can surface a
 * translated toast.
 */
export function validatePeripheralConfig(args: {
  kind: PeripheralKind;
  driver: string;
  config: Record<string, unknown>;
}):
  | { ok: true }
  | {
      ok: false;
      code: 'PERIPHERAL_DRIVER_INVALID' | 'PERIPHERAL_CONFIG_INVALID';
      message: string;
    } {
  const drivers = DRIVER_TABLE[args.kind];
  if (!drivers) {
    return {
      ok: false,
      code: 'PERIPHERAL_DRIVER_INVALID',
      message: `No drivers are registered for kind '${args.kind}' yet.`,
    };
  }
  const registration = drivers[args.driver];
  if (!registration) {
    return {
      ok: false,
      code: 'PERIPHERAL_DRIVER_INVALID',
      message: `Driver '${args.driver}' is not registered for kind '${args.kind}'.`,
    };
  }
  const parsed = registration.configSchema.safeParse(args.config);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'PERIPHERAL_CONFIG_INVALID',
      message: parsed.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    };
  }
  return { ok: true };
}

/**
 * Resolve the active adapter for a tenant + site + kind. Returns
 * null when no active row exists OR when the registered driver is
 * not implemented yet ( only ships `system` printer +
 * `manual` payment_terminal). Tenant scoping is enforced via the
 * explicit `tenantId` filter in the SELECT.
 */
export async function getPeripheralAdapter(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  kind: PeripheralKind;
}): Promise<BasePeripheralAdapter | null> {
  const overrideKey = makeOverrideKey(args.tenantId, args.siteId, args.kind);
  const overridden = TEST_ADAPTER_OVERRIDES.get(overrideKey);
  if (overridden) return overridden;

  const row = await args.db
    .select()
    .from(sitePeripherals)
    .where(
      and(
        eq(sitePeripherals.tenantId, args.tenantId),
        eq(sitePeripherals.siteId, args.siteId),
        eq(sitePeripherals.kind, args.kind),
        eq(sitePeripherals.isActive, true)
      )
    )
    .get();
  if (!row) return null;

  return instantiateAdapter(row);
}

/**
 * Instantiate an adapter from a raw row. Exposed for the tRPC
 * `peripherals.test` action which already has the row in hand and
 * does not need a second SELECT.
 */
export function instantiateAdapter(row: SitePeripheralRow): BasePeripheralAdapter | null {
  const drivers = DRIVER_TABLE[row.kind];
  const registration = drivers?.[row.driver];
  if (!registration) return null;
  return registration.factory(
    {
      tenantId: row.tenantId,
      siteId: row.siteId,
      peripheralId: row.id,
    },
    (row.config ?? {}) as Record<string, unknown>
  );
}

// =============================================================================
// Test-only override seam (mirrors services/fiscal/registry.ts pattern)
// =============================================================================

function makeOverrideKey(tenantId: string, siteId: string, kind: PeripheralKind): string {
  return `${tenantId}:${siteId}:${kind}`;
}

const TEST_ADAPTER_OVERRIDES: Map<string, BasePeripheralAdapter> = new Map();

/**
 * TEST-ONLY adapter override. Tests inject a stub adapter
 * scoped to (tenantId, siteId, kind) so registry-driven flows reach
 * a controllable instance without touching the static dispatch
 * table.
 */
export function __setPeripheralAdapterForTest(
  args: { tenantId: string; siteId: string; kind: PeripheralKind },
  adapter: BasePeripheralAdapter | null
): void {
  const key = makeOverrideKey(args.tenantId, args.siteId, args.kind);
  if (adapter === null) {
    TEST_ADAPTER_OVERRIDES.delete(key);
  } else {
    TEST_ADAPTER_OVERRIDES.set(key, adapter);
  }
}

export function __clearPeripheralAdapterOverridesForTest(): void {
  TEST_ADAPTER_OVERRIDES.clear();
}
