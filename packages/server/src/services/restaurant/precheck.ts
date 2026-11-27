/**
 * Non-fiscal restaurant precheck (precuenta) projection and ESC/POS builder.
 *
 * Strictly read-only with respect to `sales.status` and `sequentials`: never
 * consumes an invoice number and never closes the check. Includes the Colombian
 * Voluntary tip disclosure (citing Ley 1935 de 2018 for Colombian tenants) and editable suggested tip rate.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  hardwareOutbox,
  products,
  restaurantCheckLines,
  restaurantChecks,
  restaurantDiners,
  restaurantLineModifiers,
  restaurantServices,
  restaurantTables,
  saleItems,
  sales,
  sitePeripherals,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import {
  assertDraftSessionAtTableSite,
  readCashSessionSites,
} from '../../application/sales/draft-split.js';
import { writeAuditLog } from '../audit-logs.js';
import {
  buildEscPosBytes,
  type EscPosCharset,
  type ReceiptDocument,
  type ReceiptLine,
} from '../peripherals/escpos/byte-builder.js';

export const DEFAULT_PRECHECK_TIP_PERCENT = 10;

export interface PrecheckLineItem {
  saleItemId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  seatNumber: number | null;
  modifiers: Array<{
    name: string;
    quantity: number;
    unitPriceDelta: number;
    groupKind: string | null;
  }>;
  notes: string | null;
}

export interface RestaurantPrecheckDocument {
  isFiscalDocument: false;
  tenantName: string;
  siteName: string;
  tableId: string;
  tableName: string;
  checkId: string | null;
  checkLabel: string | null;
  saleNumbers: string[];
  waiterName: string | null;
  currencyCode: string;
  generatedAt: string;
  items: PrecheckLineItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  serviceChargeAmount: number;
  baseTotal: number;
  tipPercent: number;
  suggestedTipAmount: number;
  totalWithTip: number;
  voluntaryTipNoticeEs: string;
  voluntaryTipNoticeEn: string;
  escposDocument: ReceiptDocument;
}

function formatMoneySimple(amount: number, currencyCode: string): string {
  const rounded = roundMoney(amount);
  const decimals =
    currencyCode === 'COP' || currencyCode === 'CLP' || currencyCode === 'PYG' ? 0 : 2;
  const formatted = rounded.toLocaleString('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `$ ${formatted}`;
}

export function buildPrecheckEscPosDocument(
  data: Omit<RestaurantPrecheckDocument, 'escposDocument'>
): ReceiptDocument {
  const fmt = (value: number) => formatMoneySimple(value, data.currencyCode);
  const lines: ReceiptLine[] = [
    { text: data.tenantName, align: 'center', bold: true },
    { text: data.siteName, align: 'center' },
    { text: '' },
    { text: 'PRECUENTA', align: 'center', bold: true, doubleHeight: true },
    { text: 'NO ES FACTURA DE VENTA', align: 'center', bold: true },
    { text: '--------------------------------' },
    { text: `Mesa: ${data.tableName}`, bold: true },
    { text: `Cuenta: ${data.saleNumbers.join(', ')}` },
  ];
  if (data.checkLabel) {
    lines.push({ text: `Etiqueta: ${data.checkLabel}` });
  }
  if (data.waiterName) {
    lines.push({ text: `Atendido por: ${data.waiterName}` });
  }
  lines.push({ text: '--------------------------------' });

  for (const item of data.items) {
    lines.push({ text: `${item.quantity} x ${item.productName}` });
    for (const mod of item.modifiers) {
      const prefix = mod.groupKind === 'without' ? 'sin ' : '+ ';
      lines.push({ text: `  ${prefix}${mod.quantity > 1 ? `${mod.quantity}x ` : ''}${mod.name}` });
    }
    lines.push({ text: fmt(item.total), align: 'right' });
  }

  lines.push({ text: '--------------------------------' });
  lines.push({ text: `Subtotal: ${fmt(data.subtotal)}`, align: 'right' });
  if (data.taxAmount > 0) {
    lines.push({ text: `Impuestos: ${fmt(data.taxAmount)}`, align: 'right' });
  }
  if (data.discountAmount > 0) {
    lines.push({ text: `Descuento: -${fmt(data.discountAmount)}`, align: 'right' });
  }
  if (data.serviceChargeAmount > 0) {
    lines.push({ text: `Servicio: ${fmt(data.serviceChargeAmount)}`, align: 'right' });
  }
  lines.push({ text: `Total consumo: ${fmt(data.baseTotal)}`, align: 'right', bold: true });
  lines.push({
    text: `Propina voluntaria (${data.tipPercent}%): ${fmt(data.suggestedTipAmount)}`,
    align: 'right',
  });
  lines.push({
    text: `TOTAL SUGERIDO: ${fmt(data.totalWithTip)}`,
    align: 'right',
    bold: true,
    doubleHeight: true,
  });
  lines.push({ text: '' });
  lines.push({ text: data.voluntaryTipNoticeEs, align: 'center' });
  lines.push({ text: '' });
  lines.push({ text: 'Documento informativo - sin validez fiscal', align: 'center' });
  lines.push({ text: '' });

  return { lines, cut: true, kickDrawer: false };
}

export function buildRestaurantPrecheck(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    callerSiteId: string | null | undefined;
    actorId: string;
    tableId: string;
    checkId?: string | undefined;
    tipPercent?: number | undefined;
  }
): RestaurantPrecheckDocument {
  if (args.callerSiteId === null) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found at the active site',
    });
  }
  const tipPercent = roundMoney(args.tipPercent ?? DEFAULT_PRECHECK_TIP_PERCENT);
  const table = db
    .select({
      id: restaurantTables.id,
      siteId: restaurantTables.siteId,
      name: restaurantTables.name,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, args.tableId),
        eq(restaurantTables.tenantId, args.tenantId),
        eq(restaurantTables.isActive, true),
        ...(args.callerSiteId ? [eq(restaurantTables.siteId, args.callerSiteId)] : [])
      )
    )
    .get();
  if (!table) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found for this tenant',
    });
  }

  const service = db
    .select()
    .from(restaurantServices)
    .where(
      and(
        eq(restaurantServices.tenantId, args.tenantId),
        eq(restaurantServices.tableId, table.id),
        eq(restaurantServices.status, 'open')
      )
    )
    .get();
  if (!service) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_NOT_OPEN',
      message: 'The table has no open service for a precheck',
    });
  }
  if (service.siteId !== table.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant service site does not match its physical table',
    });
  }

  const checks = db
    .select({
      id: restaurantChecks.id,
      saleId: restaurantChecks.saleId,
      label: restaurantChecks.label,
      saleNumber: sales.saleNumber,
      status: sales.status,
      tableId: sales.tableId,
      cashSessionId: sales.cashSessionId,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      serviceChargeAmount: sales.serviceChargeAmount,
      total: sales.total,
      currencyCode: sales.currencyCode,
    })
    .from(restaurantChecks)
    .innerJoin(sales, and(eq(sales.id, restaurantChecks.saleId), eq(sales.tenantId, args.tenantId)))
    .where(
      and(
        eq(restaurantChecks.tenantId, args.tenantId),
        eq(restaurantChecks.serviceId, service.id),
        eq(restaurantChecks.status, 'open'),
        ...(args.checkId ? [eq(restaurantChecks.id, args.checkId)] : [])
      )
    )
    .orderBy(asc(restaurantChecks.openedAt), asc(restaurantChecks.id))
    .all();

  if (checks.length === 0) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'No open check was found for this precheck',
    });
  }
  const sessionSites = readCashSessionSites(
    db,
    args.tenantId,
    checks.flatMap(c => (c.cashSessionId ? [c.cashSessionId] : []))
  );
  for (const chk of checks) {
    if (chk.status !== 'draft' || chk.tableId !== table.id) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
        message: 'Open restaurant check sale does not match the active table draft state',
      });
    }
    assertDraftSessionAtTableSite(
      chk.cashSessionId ? sessionSites.get(chk.cashSessionId) : null,
      table.siteId
    );
  }

  const checkIds = checks.map(c => c.id);
  const diners = db
    .select({ id: restaurantDiners.id, seatNumber: restaurantDiners.seatNumber })
    .from(restaurantDiners)
    .where(
      and(eq(restaurantDiners.tenantId, args.tenantId), eq(restaurantDiners.serviceId, service.id))
    )
    .all();
  const seatByDiner = new Map(diners.map(d => [d.id, d.seatNumber]));

  const lineRows = db
    .select({
      checkLineId: restaurantCheckLines.id,
      saleItemId: saleItems.id,
      dinerId: restaurantCheckLines.dinerId,
      productNameSnapshot: saleItems.productNameSnapshot,
      currentProductName: products.name,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      total: saleItems.total,
      notes: saleItems.notes,
    })
    .from(restaurantCheckLines)
    .innerJoin(
      restaurantChecks,
      and(
        eq(restaurantChecks.id, restaurantCheckLines.checkId),
        eq(restaurantChecks.tenantId, args.tenantId)
      )
    )
    .innerJoin(sales, and(eq(sales.id, restaurantChecks.saleId), eq(sales.tenantId, args.tenantId)))
    .innerJoin(
      saleItems,
      and(
        eq(saleItems.id, restaurantCheckLines.saleItemId),
        eq(saleItems.saleId, restaurantChecks.saleId)
      )
    )
    .leftJoin(
      products,
      and(eq(products.id, saleItems.productId), eq(products.tenantId, args.tenantId))
    )
    .where(
      and(
        eq(restaurantCheckLines.tenantId, args.tenantId),
        inArray(restaurantCheckLines.checkId, checkIds)
      )
    )
    .orderBy(asc(restaurantCheckLines.createdAt), asc(restaurantCheckLines.id))
    .all();

  const checkLineIds = lineRows.map(l => l.checkLineId);
  const modRows =
    checkLineIds.length === 0
      ? []
      : db
          .select({
            checkLineId: restaurantLineModifiers.checkLineId,
            name: restaurantLineModifiers.name,
            quantity: restaurantLineModifiers.quantity,
            unitPriceDelta: restaurantLineModifiers.unitPriceDelta,
            groupKind: restaurantLineModifiers.groupKind,
          })
          .from(restaurantLineModifiers)
          .where(
            and(
              eq(restaurantLineModifiers.tenantId, args.tenantId),
              inArray(restaurantLineModifiers.checkLineId, checkLineIds)
            )
          )
          .orderBy(asc(restaurantLineModifiers.position), asc(restaurantLineModifiers.id))
          .all();

  const modsByLine = new Map<string, PrecheckLineItem['modifiers']>();
  for (const mod of modRows) {
    const list = modsByLine.get(mod.checkLineId) ?? [];
    list.push({
      name: mod.name,
      quantity: mod.quantity,
      unitPriceDelta: mod.unitPriceDelta,
      groupKind: mod.groupKind,
    });
    modsByLine.set(mod.checkLineId, list);
  }

  const tenant = db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .get();
  const site = db
    .select({ name: sites.name })
    .from(sites)
    .where(and(eq(sites.id, table.siteId), eq(sites.tenantId, args.tenantId)))
    .get();
  const waiter = db
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, args.actorId), eq(users.tenantId, args.tenantId)))
    .get();

  const subtotal = checks.reduce((s, c) => roundMoney(s + c.subtotal), 0);
  const taxAmount = checks.reduce((s, c) => roundMoney(s + c.taxAmount), 0);
  const discountAmount = checks.reduce((s, c) => roundMoney(s + c.discountAmount), 0);
  const serviceChargeAmount = checks.reduce((s, c) => roundMoney(s + c.serviceChargeAmount), 0);
  const tipBase = Math.max(0, roundMoney(subtotal + taxAmount - discountAmount));
  const baseTotal = roundMoney(tipBase + serviceChargeAmount);
  const suggestedTipAmount = roundMoney((tipBase * tipPercent) / 100);
  const totalWithTip = roundMoney(baseTotal + suggestedTipAmount);
  const currencyCode = checks[0]!.currencyCode ?? 'COP';

  // The statute is Colombian; other countries get the same disclosure without the citation.
  const isColombia =
    (db
      .select({ countryCode: tenantLocaleSettings.countryCode })
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, args.tenantId))
      .get()?.countryCode ?? 'CO') === 'CO';
  const tipText = formatMoneySimple(suggestedTipAmount, currencyCode);
  const voluntaryTipNoticeEs = `PROPINA VOLUNTARIA${isColombia ? ' (Ley 1935 de 2018)' : ''}: Se sugiere una propina voluntaria del ${tipPercent}% (${tipText}). Usted puede aceptarla, modificarla o rechazarla.`;
  const voluntaryTipNoticeEn = `VOLUNTARY TIP${isColombia ? ' (Law 1935 of 2018)' : ''}: A suggested voluntary tip of ${tipPercent}% (${tipText}) is shown. You may accept, adjust, or decline it.`;

  const baseDoc = {
    isFiscalDocument: false as const,
    tenantName: tenant?.name ?? 'Puntovivo',
    siteName: site?.name ?? '',
    tableId: table.id,
    tableName: table.name,
    checkId: args.checkId ?? (checks.length === 1 ? checks[0]!.id : null),
    checkLabel: checks.length === 1 ? (checks[0]!.label ?? null) : null,
    saleNumbers: checks.map(c => c.saleNumber),
    waiterName: waiter?.name ?? null,
    currencyCode,
    generatedAt: new Date().toISOString(),
    items: lineRows.map(row => ({
      saleItemId: row.saleItemId,
      productName: row.productNameSnapshot ?? row.currentProductName ?? row.saleItemId,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      total: row.total,
      seatNumber: row.dinerId ? (seatByDiner.get(row.dinerId) ?? null) : null,
      modifiers: modsByLine.get(row.checkLineId) ?? [],
      notes: row.notes,
    })),
    subtotal,
    taxAmount,
    discountAmount,
    serviceChargeAmount,
    baseTotal,
    tipPercent,
    suggestedTipAmount,
    totalWithTip,
    voluntaryTipNoticeEs,
    voluntaryTipNoticeEn,
  };

  return {
    ...baseDoc,
    escposDocument: buildPrecheckEscPosDocument(baseDoc),
  };
}

/**
 * Generate a non-fiscal precheck, optionally mark `billRequestedAt`, and enqueue
 * an ESC/POS print job when the site has an active thermal printer.
 */
export function printRestaurantPrecheck(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    callerSiteId: string | null | undefined;
    actorId: string;
    tableId: string;
    checkId?: string | undefined;
    tipPercent?: number | undefined;
    markBillRequested?: boolean | undefined;
    operationId: string;
    completeInTransaction: (tx: DatabaseInstance, resultRef: unknown) => void;
  }
): {
  precheck: RestaurantPrecheckDocument;
  printedVia: 'hardware_outbox' | 'browser';
  outboxId: string | null;
} {
  return db.transaction(
    rawTx => {
      const tx = rawTx as unknown as DatabaseInstance;
      const precheck = buildRestaurantPrecheck(tx, args);
      const now = new Date().toISOString();

      const table = tx
        .select({ id: restaurantTables.id, siteId: restaurantTables.siteId })
        .from(restaurantTables)
        .where(
          and(eq(restaurantTables.id, args.tableId), eq(restaurantTables.tenantId, args.tenantId))
        )
        .get()!;

      if (args.markBillRequested !== false) {
        const service = tx
          .select()
          .from(restaurantServices)
          .where(
            and(
              eq(restaurantServices.tenantId, args.tenantId),
              eq(restaurantServices.tableId, table.id),
              eq(restaurantServices.status, 'open')
            )
          )
          .get();
        if (service && service.billRequestedAt === null) {
          tx.update(restaurantServices)
            .set({
              billRequestedAt: now,
              billRequestedBy: args.actorId,
              version: service.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(restaurantServices.id, service.id),
                eq(restaurantServices.tenantId, args.tenantId),
                eq(restaurantServices.version, service.version)
              )
            )
            .run();
        }
      }

      const activePrinter = tx
        .select()
        .from(sitePeripherals)
        .where(
          and(
            eq(sitePeripherals.tenantId, args.tenantId),
            eq(sitePeripherals.siteId, table.siteId),
            eq(sitePeripherals.kind, 'printer'),
            eq(sitePeripherals.isActive, true)
          )
        )
        .get();

      let outboxId: string | null = null;
      let printedVia: 'hardware_outbox' | 'browser' = 'browser';
      if (activePrinter && activePrinter.driver === 'escpos') {
        const cfg = (activePrinter.config ?? {}) as Record<string, unknown>;
        const paperWidth = cfg.paperWidth === '58mm' ? '58mm' : '80mm';
        const characterSet = (
          typeof cfg.characterSet === 'string' ? cfg.characterSet : 'cp858'
        ) as EscPosCharset;
        const bytes = buildEscPosBytes(precheck.escposDocument, { paperWidth, characterSet });
        outboxId = nanoid();
        tx.insert(hardwareOutbox)
          .values({
            id: outboxId,
            tenantId: args.tenantId,
            status: 'queued',
            kind: 'print-receipt',
            peripheralId: activePrinter.id,
            payload: {
              kind: 'print-receipt',
              document: precheck.escposDocument,
              escposBytes: Array.from(bytes),
              siteId: table.siteId,
              isPrecheck: true,
            },
            payloadVersion: 1,
            attempts: 0,
            priority: 2,
            idempotencyKey: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        printedVia = 'hardware_outbox';
      }

      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: 'restaurant_check.precheck_printed',
        resourceType: 'restaurant_table',
        resourceId: table.id,
        before: null,
        after: {
          checkId: precheck.checkId,
          saleNumbers: precheck.saleNumbers,
          baseTotal: precheck.baseTotal,
          tipPercent: precheck.tipPercent,
          suggestedTipAmount: precheck.suggestedTipAmount,
          printedVia,
          outboxId,
        },
        operationId: args.operationId,
        metadata: { siteId: table.siteId, isFiscalDocument: false },
      });

      const result = { precheck, printedVia, outboxId };
      args.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
