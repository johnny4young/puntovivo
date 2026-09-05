/**
 * Pure, tenant-scoped planning for partial returns.
 *
 * The planner reads frozen sale provenance and prior normalized returns, then
 * produces the exact deltas the write transaction must persist. It never
 * consults live prices or tax catalogs.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  products,
  saleItemLots,
  saleItemSerials,
  saleItemTaxComponents,
  saleItems,
  salePayments,
  saleReturnItemLots,
  saleReturnItemSerials,
  saleReturnItemTaxComponents,
  saleReturnItems,
  saleReturnPaymentAllocations,
  saleReturns,
  sales,
  units,
  type Sale,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { ServerErrorCode } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';

const EPSILON = 1e-8;

export type ReturnDestination = 'original' | 'store_credit';

export interface ReturnLineInput {
  saleItemId: string;
  quantity: number;
  lotAllocations?: Array<{ saleItemLotId: string; quantity: number }> | undefined;
  serialIds?: string[] | undefined;
}

export interface ReturnExternalReferenceInput {
  /** Null identifies the single synthetic tender on pre-sale_payments tickets. */
  salePaymentId: string | null;
  reference: string;
}

export interface ReturnPlanInput {
  items?: ReturnLineInput[] | undefined;
  destination: ReturnDestination;
  externalReferences?: ReturnExternalReferenceInput[] | undefined;
  /** Preview reads may calculate allocations without receiving provider evidence. */
  requireExternalReferences?: boolean | undefined;
}

interface PlannedTaxComponent {
  componentKey: string;
  vatRateId: string | null;
  taxKind: 'iva' | 'inc';
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  position: number;
}

export interface PlannedReturnLot {
  saleItemLotId: string;
  lotId: string;
  quantity: number;
  unitCost: number;
}

export interface PlannedReturnSerial {
  saleItemSerialId: string;
  productSerialId: string;
  serialNumber: string;
}

export interface PlannedReturnLine {
  saleItemId: string;
  productId: string;
  productNameSnapshot: string;
  productSkuSnapshot: string;
  tracksStock: boolean;
  quantity: number;
  baseQuantity: number;
  unitPrice: number;
  unitEquivalence: number;
  unitStandardCode: string | null;
  discountRate: number;
  taxKind: 'iva' | 'inc';
  taxRate: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  costAmount: number;
  currencyCode: string;
  taxComponents: PlannedTaxComponent[];
  lots: PlannedReturnLot[];
  serials: PlannedReturnSerial[];
}

export interface PlannedReturnPaymentAllocation {
  salePaymentId: string | null;
  originalMethod: 'cash' | 'card' | 'transfer' | 'credit' | 'loyalty' | 'store_credit' | 'other';
  destination: 'cash' | 'receivable' | 'external' | 'loyalty' | 'store_credit';
  amount: number;
  loyaltyPoints: number | null;
  externalReference: string | null;
  /** Whether this receivable delta has a customer-ledger entry to reverse. */
  affectsCustomerLedger: boolean;
}

export interface ReturnPlan {
  lines: PlannedReturnLine[];
  allocations: PlannedReturnPaymentAllocation[];
  /** Currency frozen on the original sale header. */
  currencyCode: string;
  subtotal: number;
  tipAmount: number;
  serviceChargeAmount: number;
  /** Header discount only; per-line discounts remain frozen on each line. */
  discountAmount: number;
  taxAmount: number;
  refundAmount: number;
  cashAmount: number;
  externalAmount: number;
  receivableAmount: number;
  customerLedgerReceivableAmount: number;
  loyaltyAmount: number;
  loyaltyPoints: number;
  /** New credit issued for cash/external refunds redirected by the operator. */
  storeCreditIssueAmount: number;
  /** Existing store-credit tender restored to its source account. */
  storeCreditRestoreAmount: number;
  /** Compatibility total shown by existing preview consumers. */
  storeCreditAmount: number;
  fullyReturned: boolean;
  nextPaymentStatus: 'partially_refunded' | 'refunded';
}

function clampZero(value: number): number {
  return Math.abs(value) <= EPSILON ? 0 : value;
}

function cumulativeDelta(
  original: number,
  originalQuantity: number,
  before: number,
  added: number
) {
  const after = before + added;
  const targetBefore =
    before <= EPSILON ? 0 : roundMoney(original * Math.min(1, before / originalQuantity));
  const targetAfter =
    originalQuantity - after <= EPSILON
      ? roundMoney(original)
      : roundMoney(original * Math.min(1, after / originalQuantity));
  return roundMoney(targetAfter - targetBefore);
}

function returnError(
  errorCode: ServerErrorCode,
  message: string,
  details?: Record<string, unknown>
): never {
  throwServerError({ trpcCode: 'BAD_REQUEST', errorCode, message, details });
}

function sumMoney(values: number[]): number {
  return values.reduce((sum, value) => roundMoney(sum + value), 0);
}

function componentDelta(args: {
  originalAmount: number;
  priorAmount: number;
  originalQuantity: number;
  returnedQuantityAfter: number;
  finalLine: boolean;
  saleItemId: string;
  componentKey: string;
  field: 'taxableAmount' | 'taxAmount';
}): number {
  const cumulativeTarget = args.finalLine
    ? roundMoney(args.originalAmount)
    : roundMoney(
        args.originalAmount * Math.min(1, args.returnedQuantityAfter / args.originalQuantity)
      );
  const amount = roundMoney(cumulativeTarget - args.priorAmount);
  if (amount < -EPSILON) {
    returnError(
      'SALE_RETURN_TAX_COMPONENT_MISMATCH',
      'Prior return tax components exceed the frozen sale component',
      {
        saleItemId: args.saleItemId,
        componentKey: args.componentKey,
        field: args.field,
        originalAmount: args.originalAmount,
        priorAmount: args.priorAmount,
      }
    );
  }
  return clampZero(amount);
}

function reconcileComponentTax(
  saleItemId: string,
  expectedTaxAmount: number,
  components: Array<{
    planned: PlannedTaxComponent;
    originalTaxAmount: number;
    priorTaxAmount: number;
  }>
): PlannedTaxComponent[] {
  let remainingCents = Math.round(
    roundMoney(expectedTaxAmount - sumMoney(components.map(row => row.planned.taxAmount))) * 100
  );
  const ordered = [...components].sort((a, b) => a.planned.position - b.planned.position);

  if (remainingCents > 0) {
    for (const row of ordered) {
      const capacityCents = Math.max(
        0,
        Math.round(
          roundMoney(row.originalTaxAmount - row.priorTaxAmount - row.planned.taxAmount) * 100
        )
      );
      const applied = Math.min(remainingCents, capacityCents);
      row.planned.taxAmount = roundMoney(row.planned.taxAmount + applied / 100);
      remainingCents -= applied;
      if (remainingCents === 0) break;
    }
  } else if (remainingCents < 0) {
    for (const row of [...ordered].reverse()) {
      const removableCents = Math.max(0, Math.round(row.planned.taxAmount * 100));
      const applied = Math.min(-remainingCents, removableCents);
      row.planned.taxAmount = roundMoney(row.planned.taxAmount - applied / 100);
      remainingCents += applied;
      if (remainingCents === 0) break;
    }
  }

  if (remainingCents !== 0) {
    returnError(
      'SALE_RETURN_TAX_COMPONENT_MISMATCH',
      'Frozen tax components cannot reconcile the selected return line tax',
      { saleItemId, expectedTaxAmount }
    );
  }
  return components.map(row => row.planned);
}

function allocateLots(args: {
  original: Array<{ id: string; lotId: string; quantity: number; unitCost: number }>;
  prior: Map<string, number>;
  requested: ReturnLineInput['lotAllocations'];
  requiredQuantity: number;
  lineId: string;
}): PlannedReturnLot[] {
  const available = args.original.map(row => ({
    ...row,
    remaining: clampZero(row.quantity - (args.prior.get(row.id) ?? 0)),
  }));
  if (available.length === 0) return [];

  const requested = args.requested;
  const result: PlannedReturnLot[] = [];
  if (requested && requested.length > 0) {
    const seen = new Set<string>();
    for (const allocation of requested) {
      if (seen.has(allocation.saleItemLotId)) {
        returnError('SALE_RETURN_LOT_DUPLICATE', 'A lot can be selected only once per return');
      }
      seen.add(allocation.saleItemLotId);
      const source = available.find(row => row.id === allocation.saleItemLotId);
      if (!source || allocation.quantity - source.remaining > EPSILON) {
        returnError(
          'SALE_RETURN_LOT_QUANTITY_EXCEEDS_AVAILABLE',
          'The selected lot quantity is no longer available for return',
          { saleItemId: args.lineId, saleItemLotId: allocation.saleItemLotId }
        );
      }
      result.push({
        saleItemLotId: source.id,
        lotId: source.lotId,
        quantity: allocation.quantity,
        unitCost: source.unitCost,
      });
    }
  } else {
    let remaining = args.requiredQuantity;
    for (const source of available) {
      if (remaining <= EPSILON) break;
      const quantity = Math.min(source.remaining, remaining);
      if (quantity > EPSILON) {
        result.push({
          saleItemLotId: source.id,
          lotId: source.lotId,
          quantity,
          unitCost: source.unitCost,
        });
        remaining = clampZero(remaining - quantity);
      }
    }
  }

  const allocated = result.reduce((sum, row) => sum + row.quantity, 0);
  if (Math.abs(allocated - args.requiredQuantity) > EPSILON) {
    returnError(
      'SALE_RETURN_LOT_ALLOCATION_MISMATCH',
      'Returned lot quantities must match the selected line quantity',
      { saleItemId: args.lineId, expected: args.requiredQuantity, actual: allocated }
    );
  }
  return result;
}

function allocateSerials(args: {
  original: Array<{ id: string; productSerialId: string; serialNumber: string }>;
  returnedIds: Set<string>;
  requested: string[] | undefined;
  requiredQuantity: number;
  lineId: string;
}): PlannedReturnSerial[] {
  if (args.original.length === 0) return [];
  if (!Number.isInteger(args.requiredQuantity)) {
    returnError(
      'SALE_RETURN_SERIAL_QUANTITY_INVALID',
      'Serialized return quantities must resolve to whole units',
      { saleItemId: args.lineId }
    );
  }
  const available = args.original.filter(row => !args.returnedIds.has(row.id));
  const selected = args.requested
    ? args.requested.map(id => available.find(row => row.productSerialId === id))
    : available.slice(0, args.requiredQuantity);
  if (
    selected.length !== args.requiredQuantity ||
    selected.some((row): row is undefined => row === undefined) ||
    new Set(args.requested ?? selected.map(row => row!.productSerialId)).size !== selected.length
  ) {
    returnError(
      'SALE_RETURN_SERIAL_SELECTION_MISMATCH',
      'Select each serialized unit being returned exactly once',
      { saleItemId: args.lineId, expected: args.requiredQuantity }
    );
  }
  return selected.map(row => ({
    saleItemSerialId: row!.id,
    productSerialId: row!.productSerialId,
    serialNumber: row!.serialNumber,
  }));
}

export function buildReturnPlan(
  db: DatabaseInstance,
  tenantId: string,
  sale: Sale,
  input: ReturnPlanInput
): ReturnPlan {
  const lineRows = db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      productNameSnapshot: saleItems.productNameSnapshot,
      productSkuSnapshot: saleItems.productSkuSnapshot,
      productName: products.name,
      productSku: products.sku,
      tracksStock: saleItems.tracksStockSnapshot,
      liveTracksLots: products.tracksLots,
      liveTracksSerials: products.tracksSerials,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      unitEquivalence: saleItems.unitEquivalence,
      unitStandardCode: saleItems.unitStandardCode,
      liveUnitStandardCode: units.standardCode,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxKind: saleItems.taxKind,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      total: saleItems.total,
      currencyCode: saleItems.currencyCode,
    })
    .from(saleItems)
    .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, tenantId)))
    .innerJoin(products, and(eq(saleItems.productId, products.id), eq(products.tenantId, tenantId)))
    .leftJoin(units, and(eq(saleItems.unitId, units.id), eq(units.tenantId, tenantId)))
    // sale_items predates tenant_id; ownership is proven through the joined
    // parent sale, while every live catalog join is independently scoped.
    .where(and(eq(saleItems.saleId, sale.id), eq(sales.id, sale.id)))
    .orderBy(saleItems.id)
    .all();
  if (lineRows.length === 0) {
    returnError('SALE_WITHOUT_ITEMS', 'Cannot refund a sale without line items');
  }

  const lineIds = lineRows.map(row => row.id);
  const priorRows = db
    .select({
      saleReturnId: saleReturnItems.saleReturnId,
      saleItemId: saleReturnItems.saleItemId,
      quantity: saleReturnItems.quantity,
      taxAmount: saleReturnItems.taxAmount,
      total: saleReturnItems.total,
    })
    .from(saleReturnItems)
    .innerJoin(
      saleReturns,
      and(
        eq(saleReturnItems.saleReturnId, saleReturns.id),
        eq(saleReturns.tenantId, tenantId),
        eq(saleReturns.saleId, sale.id)
      )
    )
    .where(eq(saleReturnItems.tenantId, tenantId))
    .all();
  const returnedByLine = new Map<string, number>();
  for (const row of priorRows) {
    returnedByLine.set(row.saleItemId, (returnedByLine.get(row.saleItemId) ?? 0) + row.quantity);
  }
  const priorReturnHeaders = db
    .select({ id: saleReturns.id, refundAmount: saleReturns.refundAmount })
    .from(saleReturns)
    .where(and(eq(saleReturns.tenantId, tenantId), eq(saleReturns.saleId, sale.id)))
    .all();
  const normalizedReturnIds = new Set(priorRows.map(row => row.saleReturnId));
  const priorRefundAmount = sumMoney(priorReturnHeaders.map(row => row.refundAmount));
  if (priorReturnHeaders.some(header => !normalizedReturnIds.has(header.id))) {
    // Historical sale_returns rows predate line normalization and represented
    // full-ticket returns by contract. Never invent a quantity allocation or
    // permit another return merely because someone repaired the status flag.
    returnError('SALE_RETURN_ALREADY_REFUNDED', 'Sale is already fully refunded');
  }

  const requestedByLine = new Map((input.items ?? []).map(item => [item.saleItemId, item]));
  if (requestedByLine.size !== (input.items?.length ?? 0)) {
    returnError('SALE_RETURN_LINE_DUPLICATE', 'A sale line can be selected only once per return');
  }
  for (const requestedId of requestedByLine.keys()) {
    if (!lineIds.includes(requestedId)) {
      returnError('SALE_RETURN_LINE_NOT_FOUND', 'A selected line does not belong to this sale', {
        saleItemId: requestedId,
      });
    }
  }

  const componentRows = db
    .select()
    .from(saleItemTaxComponents)
    .where(
      and(
        eq(saleItemTaxComponents.tenantId, tenantId),
        inArray(saleItemTaxComponents.saleItemId, lineIds)
      )
    )
    .orderBy(saleItemTaxComponents.saleItemId, saleItemTaxComponents.position)
    .all();
  const componentsByLine = new Map<string, typeof componentRows>();
  for (const component of componentRows) {
    const group = componentsByLine.get(component.saleItemId) ?? [];
    group.push(component);
    componentsByLine.set(component.saleItemId, group);
  }
  for (const line of lineRows) {
    const frozenComponents = componentsByLine.get(line.id);
    if (!frozenComponents?.length) continue;
    const componentTaxAmount = sumMoney(frozenComponents.map(component => component.taxAmount));
    if (componentTaxAmount !== roundMoney(line.taxAmount)) {
      // A return must not commit inventory or money and then discover during
      // best-effort fiscal emission that its frozen tax snapshot is corrupt.
      // Legacy lines with no component rows still use the compatibility
      // summary below; once normalized rows exist they are authoritative.
      returnError(
        'SALE_RETURN_TAX_COMPONENT_MISMATCH',
        'Frozen tax components do not match the sale line tax total',
        {
          saleItemId: line.id,
          lineTaxAmount: roundMoney(line.taxAmount),
          componentTaxAmount,
        }
      );
    }
  }
  const priorComponentRows = db
    .select({
      saleItemId: saleReturnItems.saleItemId,
      componentKey: saleReturnItemTaxComponents.componentKey,
      taxableAmount: saleReturnItemTaxComponents.taxableAmount,
      taxAmount: saleReturnItemTaxComponents.taxAmount,
    })
    .from(saleReturnItemTaxComponents)
    .innerJoin(
      saleReturnItems,
      and(
        eq(saleReturnItemTaxComponents.saleReturnItemId, saleReturnItems.id),
        eq(saleReturnItems.tenantId, tenantId)
      )
    )
    .innerJoin(
      saleReturns,
      and(
        eq(saleReturnItems.saleReturnId, saleReturns.id),
        eq(saleReturns.tenantId, tenantId),
        eq(saleReturns.saleId, sale.id)
      )
    )
    .where(eq(saleReturnItemTaxComponents.tenantId, tenantId))
    .all();
  const priorComponents = new Map<string, { taxableAmount: number; taxAmount: number }>();
  for (const row of priorComponentRows) {
    const key = `${row.saleItemId}:${row.componentKey}`;
    const current = priorComponents.get(key) ?? { taxableAmount: 0, taxAmount: 0 };
    current.taxableAmount = roundMoney(current.taxableAmount + row.taxableAmount);
    current.taxAmount = roundMoney(current.taxAmount + row.taxAmount);
    priorComponents.set(key, current);
  }
  const validComponentKeysByLine = new Map<string, Set<string>>();
  for (const line of lineRows) {
    const keys = new Set(
      (componentsByLine.get(line.id) ?? []).map(component => component.componentKey)
    );
    if (keys.size === 0) {
      keys.add(`legacy:${line.taxKind}:${Number(line.taxRate).toFixed(6)}`);
    }
    validComponentKeysByLine.set(line.id, keys);
  }
  for (const component of priorComponentRows) {
    if (!validComponentKeysByLine.get(component.saleItemId)?.has(component.componentKey)) {
      returnError(
        'SALE_RETURN_TAX_COMPONENT_MISMATCH',
        'A prior return references a tax component absent from the frozen sale line',
        { saleItemId: component.saleItemId, componentKey: component.componentKey }
      );
    }
  }
  for (const line of lineRows) {
    const expectedPriorTax = sumMoney(
      priorRows.filter(row => row.saleItemId === line.id).map(row => row.taxAmount)
    );
    const actualPriorTax = sumMoney(
      priorComponentRows.filter(row => row.saleItemId === line.id).map(row => row.taxAmount)
    );
    if (expectedPriorTax !== actualPriorTax) {
      returnError(
        'SALE_RETURN_TAX_COMPONENT_MISMATCH',
        'Prior return tax components do not match their frozen return lines',
        { saleItemId: line.id, expectedPriorTax, actualPriorTax }
      );
    }
  }

  const lotRows = db
    .select()
    .from(saleItemLots)
    .where(and(eq(saleItemLots.tenantId, tenantId), inArray(saleItemLots.saleItemId, lineIds)))
    .orderBy(saleItemLots.saleItemId, saleItemLots.createdAt, saleItemLots.id)
    .all();
  const lotsByLine = new Map<string, typeof lotRows>();
  for (const lot of lotRows) {
    const group = lotsByLine.get(lot.saleItemId) ?? [];
    group.push(lot);
    lotsByLine.set(lot.saleItemId, group);
  }
  const priorLotRows = db
    .select({
      saleItemLotId: saleReturnItemLots.saleItemLotId,
      quantity: saleReturnItemLots.quantity,
    })
    .from(saleReturnItemLots)
    .innerJoin(
      saleReturnItems,
      and(
        eq(saleReturnItemLots.saleReturnItemId, saleReturnItems.id),
        eq(saleReturnItems.tenantId, tenantId)
      )
    )
    .innerJoin(
      saleReturns,
      and(
        eq(saleReturnItems.saleReturnId, saleReturns.id),
        eq(saleReturns.tenantId, tenantId),
        eq(saleReturns.saleId, sale.id)
      )
    )
    .where(eq(saleReturnItemLots.tenantId, tenantId))
    .all();
  const returnedByLot = new Map<string, number>();
  for (const row of priorLotRows) {
    returnedByLot.set(
      row.saleItemLotId,
      (returnedByLot.get(row.saleItemLotId) ?? 0) + row.quantity
    );
  }

  const serialRows = db
    .select()
    .from(saleItemSerials)
    .where(
      and(eq(saleItemSerials.tenantId, tenantId), inArray(saleItemSerials.saleItemId, lineIds))
    )
    .orderBy(saleItemSerials.saleItemId, saleItemSerials.serialNumber)
    .all();
  const serialsByLine = new Map<string, typeof serialRows>();
  for (const serial of serialRows) {
    const group = serialsByLine.get(serial.saleItemId) ?? [];
    group.push(serial);
    serialsByLine.set(serial.saleItemId, group);
  }
  const originalSaleItemSerialIds = serialRows.map(row => row.id);
  const returnedSerialRows =
    originalSaleItemSerialIds.length === 0
      ? []
      : db
          .select({ saleItemSerialId: saleReturnItemSerials.saleItemSerialId })
          .from(saleReturnItemSerials)
          .where(
            and(
              eq(saleReturnItemSerials.tenantId, tenantId),
              inArray(saleReturnItemSerials.saleItemSerialId, originalSaleItemSerialIds)
            )
          )
          .all();
  const returnedSerialIds = new Set(returnedSerialRows.map(row => row.saleItemSerialId));

  const lines: PlannedReturnLine[] = [];
  for (const line of lineRows) {
    const alreadyReturned = returnedByLine.get(line.id) ?? 0;
    const remaining = clampZero(line.quantity - alreadyReturned);
    const request = requestedByLine.get(line.id);
    const quantity = input.items === undefined ? remaining : (request?.quantity ?? 0);
    if (quantity <= EPSILON) continue;
    if (quantity - remaining > EPSILON) {
      returnError(
        'SALE_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
        'The return quantity exceeds the remaining sale quantity',
        { saleItemId: line.id, remaining, requested: quantity }
      );
    }

    const hadLotProvenance = (lotsByLine.get(line.id)?.length ?? 0) > 0;
    if (line.liveTracksLots !== hadLotProvenance) {
      // Sale provenance is immutable, but the catalog can change after the
      // ticket. Restoring aggregate stock under a different lot mode would
      // make inventory_balances disagree with the lot ledger.
      returnError(
        'SALE_RETURN_LOT_TRACKING_CHANGED',
        'Product lot tracking changed after the sale',
        { saleItemId: line.id }
      );
    }

    const hadSerialProvenance = (serialsByLine.get(line.id)?.length ?? 0) > 0;
    if (line.liveTracksSerials !== hadSerialProvenance) {
      // A return can only re-enter serialized inventory when the frozen sale
      // identifies the exact units and the live catalog still owns them.
      returnError(
        'SALE_RETURN_SERIAL_TRACKING_CHANGED',
        'Product serial tracking changed after the sale',
        { saleItemId: line.id }
      );
    }

    const baseQuantity = quantity * line.unitEquivalence;
    const subtotalOriginal = roundMoney(line.total - line.taxAmount);
    const subtotal = cumulativeDelta(subtotalOriginal, line.quantity, alreadyReturned, quantity);
    const taxAmount = cumulativeDelta(line.taxAmount, line.quantity, alreadyReturned, quantity);
    const total = cumulativeDelta(line.total, line.quantity, alreadyReturned, quantity);
    const grossOriginal = roundMoney(line.unitPrice * line.quantity);
    const discountOriginal = roundMoney((grossOriginal * line.discount) / 100);
    const discountAmount = cumulativeDelta(
      discountOriginal,
      line.quantity,
      alreadyReturned,
      quantity
    );
    const costOriginal = roundMoney(line.costAtSale * line.quantity * line.unitEquivalence);

    const originals = componentsByLine.get(line.id) ?? [
      {
        id: `legacy:${line.id}`,
        tenantId,
        saleItemId: line.id,
        componentKey: `legacy:${line.taxKind}:${Number(line.taxRate).toFixed(6)}`,
        vatRateId: null,
        taxKind: line.taxKind,
        taxRate: line.taxRate,
        taxableAmount: subtotalOriginal,
        taxAmount: line.taxAmount,
        position: 0,
        createdAt: sale.createdAt,
      },
    ];
    const finalLine = line.quantity - (alreadyReturned + quantity) <= EPSILON;
    const componentStates = originals.map(component => {
      const prior = priorComponents.get(`${line.id}:${component.componentKey}`) ?? {
        taxableAmount: 0,
        taxAmount: 0,
      };
      return {
        planned: {
          componentKey: component.componentKey,
          vatRateId: component.vatRateId,
          taxKind: component.taxKind,
          taxRate: component.taxRate,
          taxableAmount: componentDelta({
            originalAmount: component.taxableAmount,
            priorAmount: prior.taxableAmount,
            originalQuantity: line.quantity,
            returnedQuantityAfter: alreadyReturned + quantity,
            finalLine,
            saleItemId: line.id,
            componentKey: component.componentKey,
            field: 'taxableAmount',
          }),
          taxAmount: componentDelta({
            originalAmount: component.taxAmount,
            priorAmount: prior.taxAmount,
            originalQuantity: line.quantity,
            returnedQuantityAfter: alreadyReturned + quantity,
            finalLine,
            saleItemId: line.id,
            componentKey: component.componentKey,
            field: 'taxAmount',
          }),
          position: component.position,
        },
        originalTaxAmount: component.taxAmount,
        priorTaxAmount: prior.taxAmount,
      };
    });
    const taxComponents = reconcileComponentTax(line.id, taxAmount, componentStates);
    const lots = allocateLots({
      original: (lotsByLine.get(line.id) ?? []).map(row => ({
        id: row.id,
        lotId: row.lotId,
        quantity: row.quantity,
        unitCost: row.unitCost,
      })),
      prior: returnedByLot,
      requested: request?.lotAllocations,
      requiredQuantity: baseQuantity,
      lineId: line.id,
    });
    // Lot provenance owns cost when it exists. The product-level costAtSale is
    // only an average fallback for non-lot lines; using it for a specifically
    // selected lot would distort both the immutable return snapshot and the
    // realized-margin report whenever the consumed lots had different costs.
    const costAmount =
      lots.length > 0
        ? sumMoney(lots.map(lot => roundMoney(lot.quantity * lot.unitCost)))
        : cumulativeDelta(costOriginal, line.quantity, alreadyReturned, quantity);
    const serials = allocateSerials({
      original: (serialsByLine.get(line.id) ?? []).map(row => ({
        id: row.id,
        productSerialId: row.productSerialId,
        serialNumber: row.serialNumber,
      })),
      returnedIds: returnedSerialIds,
      requested: request?.serialIds,
      requiredQuantity: baseQuantity,
      lineId: line.id,
    });
    lines.push({
      saleItemId: line.id,
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot ?? line.productName,
      productSkuSnapshot: line.productSkuSnapshot ?? line.productSku,
      tracksStock: line.tracksStock ?? true,
      quantity,
      baseQuantity,
      unitPrice: line.unitPrice,
      unitEquivalence: line.unitEquivalence,
      unitStandardCode: line.unitStandardCode ?? line.liveUnitStandardCode,
      discountRate: line.discount,
      taxKind: line.taxKind,
      taxRate: line.taxRate,
      subtotal,
      discountAmount,
      taxAmount,
      total,
      costAmount,
      currencyCode: line.currencyCode,
      taxComponents,
      lots,
      serials,
    });
  }
  if (lines.length === 0) {
    if (sale.total - priorRefundAmount <= EPSILON) {
      returnError('SALE_RETURN_ALREADY_REFUNDED', 'Sale is already fully refunded');
    }
    returnError('SALE_RETURN_NOTHING_AVAILABLE', 'No returnable quantity remains on this sale');
  }

  const lineRefundAmount = sumMoney(lines.map(line => line.total));
  const originalLineAmount = sumMoney(lineRows.map(line => line.total));
  const priorReturnedLineAmount = sumMoney(priorRows.map(line => line.total));
  const remainingSaleAmount = roundMoney(sale.total - priorRefundAmount);
  const allLineQuantitiesReturned = lineRows.every(line => {
    const current = lines.find(item => item.saleItemId === line.id)?.quantity ?? 0;
    return line.quantity - ((returnedByLine.get(line.id) ?? 0) + current) <= EPSILON;
  });
  // Header-only money (ticket discount, tip and service charge) follows the
  // cumulative share of returned merchandise. Cumulative-delta allocation
  // makes multiple partial returns add up to the exact original cents; the
  // final line receives any rounding remainder. Zero-price merchandise is a
  // valid edge case, so its header-only money remains deferred until all
  // quantities are returned instead of dividing by zero.
  const allocateHeaderDelta = (original: number) => {
    if (originalLineAmount <= EPSILON) {
      return allLineQuantitiesReturned ? roundMoney(original) : 0;
    }
    return cumulativeDelta(original, originalLineAmount, priorReturnedLineAmount, lineRefundAmount);
  };
  const headerDiscountAmount = allocateHeaderDelta(sale.discountAmount);
  const tipAmount = allocateHeaderDelta(sale.tipAmount);
  const serviceChargeAmount = allocateHeaderDelta(sale.serviceChargeAmount);
  const refundAmount = Math.min(
    roundMoney(lineRefundAmount - headerDiscountAmount + tipAmount + serviceChargeAmount),
    remainingSaleAmount
  );
  // Zero-value merchandise is still physically returnable. This occurs with
  // free bundle items and fully discounted lines, including after another
  // partial return already exhausted the ticket's paid balance. Persist the
  // provenance/stock delta with no tender allocation; reject only corruption
  // that would make the remaining monetary balance negative.
  if (refundAmount < -EPSILON) {
    returnError('SALE_RETURN_NOTHING_AVAILABLE', 'No refundable balance remains on this sale');
  }
  const fullyReturned = remainingSaleAmount - refundAmount <= EPSILON && allLineQuantitiesReturned;

  const payments = db
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.tenantId, tenantId), eq(salePayments.saleId, sale.id)))
    .orderBy(salePayments.createdAt, salePayments.id)
    .all();
  const persistedPaymentSources =
    payments.length > 0
      ? payments.map(payment => ({
          id: payment.id as string | null,
          method: payment.method,
          amount: payment.amount,
          loyaltyPoints: payment.loyaltyPoints,
          affectsCustomerLedger: payment.method === 'credit',
        }))
      : [
          {
            id: null,
            method: sale.paymentMethod,
            amount: sale.total,
            loyaltyPoints: null,
            affectsCustomerLedger: sale.paymentMethod === 'credit',
          },
        ];
  const invalidCustomerValueSource = persistedPaymentSources.find(
    source =>
      (source.method === 'loyalty' || source.method === 'store_credit') &&
      (source.id === null ||
        source.amount <= 0 ||
        (source.method === 'loyalty' &&
          (!Number.isInteger(source.loyaltyPoints) || (source.loyaltyPoints ?? 0) <= 0)))
  );
  if (invalidCustomerValueSource) {
    returnError(
      'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
      'The original customer-value tender is incomplete',
      {
        salePaymentId: invalidCustomerValueSource.id,
        method: invalidCustomerValueSource.method,
      }
    );
  }
  const persistedTenderTotal = sumMoney(persistedPaymentSources.map(payment => payment.amount));
  if (persistedTenderTotal - sale.total > EPSILON) {
    returnError(
      'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
      'The original tenders exceed the frozen sale total'
    );
  }
  const untenderedAmount = roundMoney(sale.total - persistedTenderTotal);
  // A completed legacy partial-payment sale records only what reached the
  // drawer/provider. The untendered remainder was posted as receivable by the
  // accounting bridge but has no customer-ledger row, so model it explicitly
  // for return allocation without inventing customer debt.
  const paymentSources = [
    ...persistedPaymentSources,
    ...(untenderedAmount > 0
      ? [
          {
            id: null,
            method: 'credit' as const,
            amount: untenderedAmount,
            loyaltyPoints: null,
            affectsCustomerLedger: false,
          },
        ]
      : []),
  ];
  const priorPaymentRows = db
    .select({
      salePaymentId: saleReturnPaymentAllocations.salePaymentId,
      originalMethod: saleReturnPaymentAllocations.originalMethod,
      amount: saleReturnPaymentAllocations.amount,
    })
    .from(saleReturnPaymentAllocations)
    .innerJoin(
      saleReturns,
      and(
        eq(saleReturnPaymentAllocations.saleReturnId, saleReturns.id),
        eq(saleReturns.tenantId, tenantId),
        eq(saleReturns.saleId, sale.id)
      )
    )
    .where(eq(saleReturnPaymentAllocations.tenantId, tenantId))
    .all();
  const priorByPayment = new Map<string, number>();
  for (const row of priorPaymentRows) {
    const key = row.salePaymentId ?? `legacy:${row.originalMethod}`;
    priorByPayment.set(key, roundMoney((priorByPayment.get(key) ?? 0) + row.amount));
  }
  const referenceKey = (salePaymentId: string | null, method: string) =>
    salePaymentId ?? `legacy:${method}`;
  const references = new Map(
    (input.externalReferences ?? []).map(reference => [
      reference.salePaymentId ?? `legacy:${sale.paymentMethod}`,
      reference.reference,
    ])
  );
  const cumulativeRefund = roundMoney(priorRefundAmount + refundAmount);
  let cumulativeTenderAmount = 0;
  let cumulativeTargetAmount = 0;
  const paymentTargets = paymentSources.map((source, index) => {
    cumulativeTenderAmount = roundMoney(cumulativeTenderAmount + source.amount);
    // Allocate rounded cents at cumulative boundaries rather than rounding
    // every tender independently. The last boundary is the exact cumulative
    // refund, so even three one-cent tenders can fund a one-cent return and
    // every sequence of partial returns still converges to the original mix.
    const targetThroughSource =
      index === paymentSources.length - 1
        ? cumulativeRefund
        : roundMoney(cumulativeRefund * Math.min(1, cumulativeTenderAmount / sale.total));
    const target = roundMoney(targetThroughSource - cumulativeTargetAmount);
    cumulativeTargetAmount = targetThroughSource;
    if (target < 0 || target - source.amount > EPSILON) {
      returnError(
        'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
        'The original tender balance cannot fund this return',
        { salePaymentId: source.id, target, originalAmount: source.amount }
      );
    }
    return target;
  });
  const allocations: PlannedReturnPaymentAllocation[] = [];
  for (const [index, source] of paymentSources.entries()) {
    const key = source.id ?? `legacy:${source.method}`;
    const prior = priorByPayment.get(key) ?? 0;
    const target = paymentTargets[index]!;
    const amount = roundMoney(target - prior);
    if (amount < 0) {
      returnError(
        'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
        'A prior return exceeds the deterministic tender allocation',
        { salePaymentId: source.id, target, prior }
      );
    }
    if (amount <= 0) continue;
    // A credit tender is an unpaid receivable, not money the customer paid.
    // Returning it must reduce that debt even when the paid portions are sent
    // to store credit; converting debt into a new asset would double-benefit.
    const allocationDestination =
      source.method === 'credit'
        ? ('receivable' as const)
        : source.method === 'loyalty'
          ? ('loyalty' as const)
          : source.method === 'store_credit'
            ? ('store_credit' as const)
            : input.destination === 'store_credit'
              ? ('store_credit' as const)
              : source.method === 'cash'
                ? ('cash' as const)
                : ('external' as const);
    const externalReference = references.get(referenceKey(source.id, source.method)) ?? null;
    if (
      allocationDestination === 'external' &&
      !externalReference &&
      input.requireExternalReferences !== false
    ) {
      returnError(
        'SALE_RETURN_EXTERNAL_REFERENCE_REQUIRED',
        'An external refund reference is required for card, transfer and other tenders',
        { salePaymentId: source.id, method: source.method }
      );
    }
    allocations.push({
      salePaymentId: source.id,
      originalMethod: source.method,
      destination: allocationDestination,
      amount,
      loyaltyPoints:
        source.method === 'loyalty' && source.loyaltyPoints
          ? Math.floor(source.loyaltyPoints * Math.min(1, Math.max(0, target / source.amount))) -
            Math.floor(source.loyaltyPoints * Math.min(1, Math.max(0, prior / source.amount)))
          : null,
      externalReference,
      affectsCustomerLedger: source.affectsCustomerLedger,
    });
  }
  const allocationTotal = sumMoney(allocations.map(allocation => allocation.amount));
  if (allocationTotal !== refundAmount) {
    returnError(
      'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
      'The original tender balance cannot fund this return',
      { expected: refundAmount, actual: allocationTotal }
    );
  }

  return {
    lines,
    allocations,
    currencyCode: sale.currencyCode,
    // Tip and service charge are non-taxed header additions. Including them
    // in the tax-exclusive subtotal keeps fiscal header and synthetic charge
    // lines reconcilable without misrepresenting a product price.
    subtotal: sumMoney([...lines.map(line => line.subtotal), tipAmount, serviceChargeAmount]),
    tipAmount,
    serviceChargeAmount,
    discountAmount: headerDiscountAmount,
    taxAmount: sumMoney(lines.map(line => line.taxAmount)),
    refundAmount,
    cashAmount: sumMoney(
      allocations.filter(allocation => allocation.destination === 'cash').map(row => row.amount)
    ),
    externalAmount: sumMoney(
      allocations.filter(allocation => allocation.destination === 'external').map(row => row.amount)
    ),
    receivableAmount: sumMoney(
      allocations
        .filter(allocation => allocation.destination === 'receivable')
        .map(row => row.amount)
    ),
    customerLedgerReceivableAmount: sumMoney(
      allocations
        .filter(
          allocation => allocation.destination === 'receivable' && allocation.affectsCustomerLedger
        )
        .map(row => row.amount)
    ),
    loyaltyAmount: sumMoney(
      allocations.filter(allocation => allocation.destination === 'loyalty').map(row => row.amount)
    ),
    loyaltyPoints: allocations
      .filter(allocation => allocation.destination === 'loyalty')
      .reduce((sum, allocation) => sum + (allocation.loyaltyPoints ?? 0), 0),
    storeCreditIssueAmount: sumMoney(
      allocations
        .filter(
          allocation =>
            allocation.destination === 'store_credit' &&
            allocation.originalMethod !== 'store_credit'
        )
        .map(row => row.amount)
    ),
    storeCreditRestoreAmount: sumMoney(
      allocations
        .filter(
          allocation =>
            allocation.destination === 'store_credit' &&
            allocation.originalMethod === 'store_credit'
        )
        .map(row => row.amount)
    ),
    storeCreditAmount: sumMoney(
      allocations
        .filter(allocation => allocation.destination === 'store_credit')
        .map(row => row.amount)
    ),
    fullyReturned,
    nextPaymentStatus: fullyReturned ? 'refunded' : 'partially_refunded',
  };
}
