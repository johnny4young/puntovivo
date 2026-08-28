import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { productTaxComponents, vatRates, type TaxKind } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';
import { splitLineTax } from '@puntovivo/shared/tax-split';

export const MAX_TAX_COMPONENTS_PER_LINE = 4;

export interface TaxComponentInput {
  vatRateId: string;
}

export interface TaxComponentDefinition {
  componentKey: string;
  vatRateId: string | null;
  taxKind: TaxKind;
  taxRate: number;
  position: number;
}

export interface TaxComponentSnapshot extends TaxComponentDefinition {
  taxableAmount: number;
  taxAmount: number;
}

export interface LegacyTaxSummary {
  vatRateId: string | null;
  taxKind: TaxKind;
  taxRate: number;
}

export function legacyComponent(summary: LegacyTaxSummary): TaxComponentDefinition {
  return {
    componentKey: summary.vatRateId
      ? `vat:${summary.vatRateId}`
      : `legacy:${summary.taxKind}:${Number(summary.taxRate).toFixed(6)}`,
    vatRateId: summary.vatRateId,
    taxKind: summary.taxKind,
    taxRate: summary.taxRate,
    position: 0,
  };
}

function assertComponentCountAndUniqueness(components: readonly TaxComponentDefinition[]): void {
  if (components.length === 0 || components.length > MAX_TAX_COMPONENTS_PER_LINE) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TAX_COMPONENTS_INVALID',
      message: `A line requires between one and ${MAX_TAX_COMPONENTS_PER_LINE} tax components`,
      details: { componentCount: components.length },
    });
  }

  const keys = new Set<string>();
  for (const component of components) {
    if (
      !Number.isFinite(component.taxRate) ||
      component.taxRate < 0 ||
      component.taxRate > 100 ||
      keys.has(component.componentKey)
    ) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TAX_COMPONENTS_INVALID',
        message: 'Tax components must be unique and use rates between zero and one hundred',
        details: { componentKey: component.componentKey, taxRate: component.taxRate },
      });
    }
    keys.add(component.componentKey);
  }
}

export function summarizeTaxComponents(
  components: readonly TaxComponentDefinition[]
): LegacyTaxSummary {
  assertComponentCountAndUniqueness(components);
  const primary = components[0]!;
  return {
    vatRateId: primary.vatRateId,
    taxKind: primary.taxKind,
    taxRate: components.reduce((sum, component) => sum + component.taxRate, 0),
  };
}

export async function resolveTaxComponentInputs(
  db: DatabaseInstance,
  tenantId: string,
  inputs: readonly TaxComponentInput[]
): Promise<TaxComponentDefinition[]> {
  if (inputs.length === 0 || inputs.length > MAX_TAX_COMPONENTS_PER_LINE) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TAX_COMPONENTS_INVALID',
      message: `A line requires between one and ${MAX_TAX_COMPONENTS_PER_LINE} tax components`,
      details: { componentCount: inputs.length },
    });
  }
  const ids = inputs.map(input => input.vatRateId);
  if (new Set(ids).size !== ids.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TAX_COMPONENTS_INVALID',
      message: 'Tax components must be unique',
    });
  }

  const rows = db
    .select({
      id: vatRates.id,
      kind: vatRates.kind,
      rate: vatRates.rate,
      isActive: vatRates.isActive,
    })
    .from(vatRates)
    .where(and(eq(vatRates.tenantId, tenantId), inArray(vatRates.id, ids)))
    .all();
  const byId = new Map(rows.map(row => [row.id, row]));
  const resolved = ids.map((id, position) => {
    const row = byId.get(id);
    if (!row || row.isActive === false) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TAX_COMPONENTS_INVALID',
        message: 'Selected tax component was not found or is inactive',
        details: { vatRateId: id },
      });
    }
    return {
      componentKey: `vat:${row.id}`,
      vatRateId: row.id,
      taxKind: row.kind,
      taxRate: row.rate,
      position,
    };
  });
  assertComponentCountAndUniqueness(resolved);
  return resolved;
}

export async function replaceProductTaxComponents(
  db: DatabaseInstance,
  tenantId: string,
  productId: string,
  components: readonly TaxComponentDefinition[],
  now: string
): Promise<void> {
  assertComponentCountAndUniqueness(components);
  db.delete(productTaxComponents)
    .where(
      and(
        eq(productTaxComponents.tenantId, tenantId),
        eq(productTaxComponents.productId, productId)
      )
    )
    .run();
  for (const [position, component] of components.entries()) {
    db.insert(productTaxComponents)
      .values({
        id: nanoid(),
        tenantId,
        productId,
        componentKey: component.componentKey,
        vatRateId: component.vatRateId,
        taxKind: component.taxKind,
        taxRate: component.taxRate,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export function getProductTaxComponents(
  db: DatabaseInstance,
  tenantId: string,
  productIds: readonly string[]
): Map<string, TaxComponentDefinition[]> {
  if (productIds.length === 0) return new Map();
  const rows = db
    .select({
      productId: productTaxComponents.productId,
      componentKey: productTaxComponents.componentKey,
      vatRateId: productTaxComponents.vatRateId,
      taxKind: productTaxComponents.taxKind,
      taxRate: productTaxComponents.taxRate,
      position: productTaxComponents.position,
    })
    .from(productTaxComponents)
    .where(
      and(
        eq(productTaxComponents.tenantId, tenantId),
        inArray(productTaxComponents.productId, [...productIds])
      )
    )
    .orderBy(asc(productTaxComponents.productId), asc(productTaxComponents.position))
    .all();
  const result = new Map<string, TaxComponentDefinition[]>();
  for (const row of rows) {
    const group = result.get(row.productId) ?? [];
    group.push(row);
    result.set(row.productId, group);
  }
  return result;
}

export function calculateTaxComponentSnapshots(args: {
  components: readonly TaxComponentDefinition[];
  unitPrice: number;
  quantity: number;
  discountPercent: number;
  priceIncludesTax: boolean;
}): {
  components: TaxComponentSnapshot[];
  lineBase: number;
  lineTax: number;
  lineTotal: number;
  discountAmount: number;
} {
  assertComponentCountAndUniqueness(args.components);
  const totalRate = args.components.reduce((sum, component) => sum + component.taxRate, 0);
  const split = splitLineTax({
    unitPrice: args.unitPrice,
    quantity: args.quantity,
    discountPercent: args.discountPercent,
    taxRate: totalRate,
    priceIncludesTax: args.priceIncludesTax,
  });

  const snapshots = args.components.map(component => ({
    ...component,
    taxableAmount: split.lineBase,
    taxAmount: roundMoney(split.lineBase * (component.taxRate / 100)),
  }));
  const allocated = snapshots.reduce((sum, component) => roundMoney(sum + component.taxAmount), 0);
  const remainder = roundMoney(split.lineTax - allocated);
  if (remainder !== 0) {
    let target = 0;
    for (let index = 1; index < snapshots.length; index += 1) {
      if (snapshots[index]!.taxRate > snapshots[target]!.taxRate) target = index;
    }
    snapshots[target] = {
      ...snapshots[target]!,
      taxAmount: roundMoney(snapshots[target]!.taxAmount + remainder),
    };
  }

  if (snapshots.some(component => component.taxAmount < 0)) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'TAX_COMPONENTS_INVALID',
      message: 'Tax component rounding produced an invalid negative amount',
    });
  }
  return { ...split, components: snapshots };
}

export function assertTaxComponentsRepresentable(
  countryCode: string,
  components: readonly TaxComponentDefinition[]
): void {
  assertComponentCountAndUniqueness(components);
  if (countryCode !== 'MX' && countryCode !== 'CL') return;
  const effective = components.filter(component => component.taxRate > 0);
  const supported =
    effective.length <= 1 && effective.every(component => component.taxKind === 'iva');
  if (supported) return;
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'TAX_COMPONENTS_UNREPRESENTABLE',
    message: `${countryCode} fiscal output cannot represent this tax component combination`,
    details: {
      countryCode,
      components: effective.map(({ taxKind, taxRate }) => ({ taxKind, taxRate })),
    },
  });
}
