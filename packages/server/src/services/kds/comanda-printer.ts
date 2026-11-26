/**
 * Station-routed thermal kitchen comanda builders and transactional outbox enqueue.
 *
 * Pure ESC/POS documents render orders and voids per kitchen station and enqueue
 * into `hardware_outbox` inside the same SQLite transaction as the KDS submission
 * or void event so kitchen paper never silently drops on crash.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  hardwareOutbox,
  kdsStations,
  sitePeripherals,
  users,
  type KdsModifierSnapshot,
  type KdsStationPrinterConfig,
} from '../../db/schema.js';
import {
  buildEscPosBytes,
  type EscPosCharset,
  type ReceiptDocument,
  type ReceiptLine,
} from '../peripherals/escpos/byte-builder.js';

const COURSE_LABELS_ES: Record<string, string> = {
  starter: 'ENTRADAS',
  main: 'FUERTES',
  dessert: 'POSTRES',
  drink: 'BEBIDAS',
  other: 'OTROS',
};

const COURSE_ORDER = ['starter', 'main', 'dessert', 'drink', 'other'] as const;

export interface KitchenComandaLineInput {
  productName: string;
  quantity: number;
  unitLabel?: string | null | undefined;
  courseKey?: string | null | undefined;
  dinerLabel?: string | null | undefined;
  modifiers?: readonly KdsModifierSnapshot[] | undefined;
  notes?: string | null | undefined;
}

export interface KitchenComandaInput {
  stationName: string;
  stationCode: string;
  tableLabel?: string | null | undefined;
  saleNumber: string;
  roundLabel?: string | null | undefined;
  waiterName?: string | null | undefined;
  timestampIso: string;
  lines: readonly KitchenComandaLineInput[];
  orderNotes?: string | null | undefined;
}

export interface KitchenVoidTicketInput {
  stationName: string;
  stationCode: string;
  tableLabel?: string | null | undefined;
  saleNumber: string;
  actorName?: string | null | undefined;
  reason: 'discard' | 'void';
  timestampIso: string;
  lines: readonly Array<{
    productName: string;
    quantity: number;
    dinerLabel?: string | null | undefined;
  }>[number][];
}

function formatKitchenTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatModifierLine(modifier: KdsModifierSnapshot): string {
  const qty = modifier.quantity > 1 ? `${modifier.quantity}x ` : '';
  if (modifier.kind === 'without') return `  - SIN ${modifier.name.toUpperCase()}`;
  if (modifier.kind === 'extra') return `  + ${qty}${modifier.name}`;
  return `  * ${qty}${modifier.name}`;
}

/** Pure ESC/POS document for a kitchen preparation ticket routed to one station. */
export function buildKitchenComandaDocument(input: KitchenComandaInput): ReceiptDocument {
  const lines: ReceiptLine[] = [];

  lines.push({
    text: input.stationName.toUpperCase(),
    align: 'center',
    bold: true,
    doubleHeight: true,
  });
  lines.push({ text: 'COMANDA DE COCINA', align: 'center', bold: true });
  lines.push({ text: '--------------------------------' });
  lines.push({
    text: `Mesa: ${input.tableLabel?.trim() || 'Para llevar'}`,
    bold: true,
    doubleHeight: true,
  });
  lines.push({
    text: `Cuenta: ${input.saleNumber}   Hora: ${formatKitchenTime(input.timestampIso)}`,
  });
  if (input.roundLabel) {
    lines.push({ text: `Ronda: ${input.roundLabel}`, bold: true });
  }
  if (input.waiterName) {
    lines.push({ text: `Mesero: ${input.waiterName}` });
  }
  lines.push({ text: '--------------------------------' });

  const grouped = new Map<string, KitchenComandaLineInput[]>();
  for (const item of input.lines) {
    const key = item.courseKey && COURSE_LABELS_ES[item.courseKey] ? item.courseKey : 'other';
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  const orderedCourses = COURSE_ORDER.filter(key => grouped.has(key));
  for (const courseKey of orderedCourses) {
    const courseLines = grouped.get(courseKey) ?? [];
    if (orderedCourses.length > 1 || courseKey !== 'other') {
      lines.push({ text: `[ ${COURSE_LABELS_ES[courseKey]} ]`, bold: true });
    }
    for (const item of courseLines) {
      const unitSuffix = item.unitLabel ? ` ${item.unitLabel}` : '';
      const dinerSuffix = item.dinerLabel ? ` (${item.dinerLabel})` : '';
      lines.push({
        text: `${item.quantity}${unitSuffix} x ${item.productName}${dinerSuffix}`,
        bold: true,
      });
      for (const mod of item.modifiers ?? []) {
        lines.push({ text: formatModifierLine(mod) });
      }
      if (item.notes?.trim()) {
        lines.push({ text: `  Nota: ${item.notes.trim()}` });
      }
    }
    lines.push({ text: '' });
  }

  if (input.orderNotes?.trim()) {
    lines.push({ text: '--------------------------------' });
    lines.push({ text: `Nota general: ${input.orderNotes.trim()}`, bold: true });
  }

  lines.push({ text: '' });
  return { lines, cut: true, kickDrawer: false };
}

/** Pure ESC/POS document warning a kitchen station that submitted items were voided. */
export function buildKitchenVoidDocument(input: KitchenVoidTicketInput): ReceiptDocument {
  const lines: ReceiptLine[] = [
    { text: '*** ANULACION ***', align: 'center', bold: true, doubleHeight: true },
    { text: 'NO PREPARAR', align: 'center', bold: true },
    { text: input.stationName.toUpperCase(), align: 'center', bold: true },
    { text: '--------------------------------' },
    { text: `Mesa: ${input.tableLabel?.trim() || 'Para llevar'}`, bold: true },
    { text: `Cuenta: ${input.saleNumber}   Hora: ${formatKitchenTime(input.timestampIso)}` },
    { text: `Motivo: ${input.reason === 'discard' ? 'Cuenta descartada' : 'Venta anulada'}` },
  ];
  if (input.actorName) {
    lines.push({ text: `Responsable: ${input.actorName}` });
  }
  lines.push({ text: '--------------------------------' });
  for (const item of input.lines) {
    const diner = item.dinerLabel ? ` (${item.dinerLabel})` : '';
    lines.push({ text: `ANULAR ${item.quantity} x ${item.productName}${diner}`, bold: true });
  }
  lines.push({ text: '' });
  return { lines, cut: true, kickDrawer: false };
}

function hasActiveStationPrinter(
  config: KdsStationPrinterConfig | null | undefined
): config is KdsStationPrinterConfig & { mode: 'site_printer' | 'tcp' } {
  return Boolean(config && (config.mode === 'site_printer' || config.mode === 'tcp'));
}

function resolveSitePrinterPeripheralId(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string
): string | null {
  const row = tx
    .select({ id: sitePeripherals.id })
    .from(sitePeripherals)
    .where(
      and(
        eq(sitePeripherals.tenantId, tenantId),
        eq(sitePeripherals.siteId, siteId),
        eq(sitePeripherals.kind, 'printer'),
        eq(sitePeripherals.isActive, true)
      )
    )
    .get();
  return row?.id ?? null;
}

function insertComandaOutboxJob(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    saleId: string;
    stationCode: string;
    stationName: string;
    orderId: string;
    ticketKind: 'order' | 'void';
    printerConfig: KdsStationPrinterConfig & { mode: 'site_printer' | 'tcp' };
    document: ReceiptDocument;
    idempotencyBase: string;
    now: string;
  }
): string[] {
  const paperWidth = args.printerConfig.paperWidth ?? '80mm';
  const characterSet: EscPosCharset = args.printerConfig.characterSet ?? 'cp858';
  const copies = Math.max(1, Math.min(3, Math.trunc(args.printerConfig.copies ?? 1)));
  const bytes = buildEscPosBytes(args.document, { paperWidth, characterSet });
  const peripheralId =
    args.printerConfig.mode === 'site_printer'
      ? resolveSitePrinterPeripheralId(tx, args.tenantId, args.siteId)
      : null;

  const insertedIds: string[] = [];
  for (let copy = 1; copy <= copies; copy += 1) {
    const idempotencyKey = `${args.idempotencyBase}:c${copy}`;
    const existing = tx
      .select({ id: hardwareOutbox.id })
      .from(hardwareOutbox)
      .where(
        and(
          eq(hardwareOutbox.tenantId, args.tenantId),
          eq(hardwareOutbox.kind, 'print-kitchen-ticket'),
          eq(hardwareOutbox.idempotencyKey, idempotencyKey)
        )
      )
      .get();
    if (existing) continue;

    const id = nanoid();
    tx.insert(hardwareOutbox)
      .values({
        id,
        tenantId: args.tenantId,
        status: 'queued',
        kind: 'print-kitchen-ticket',
        peripheralId,
        payload: {
          kind: 'print-kitchen-ticket',
          document: args.document,
          escposBytes: Array.from(bytes),
          saleId: args.saleId,
          siteId: args.siteId,
          stationCode: args.stationCode,
          stationName: args.stationName,
          orderId: args.orderId,
          ticketKind: args.ticketKind,
          stationPrinterConfig: args.printerConfig,
        },
        payloadVersion: 1,
        attempts: 0,
        priority: args.ticketKind === 'void' ? 10 : 5,
        idempotencyKey,
        createdAt: args.now,
        updatedAt: args.now,
      })
      .run();
    insertedIds.push(id);
  }
  return insertedIds;
}

/**
 * Enqueue ESC/POS comanda print jobs for newly submitted KDS station tickets whose
 * station has a thermal printer configured. Synchronous inside the sale/round tx.
 */
export function enqueueStationComandaInTransaction(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    actorId: string;
    saleId: string;
    saleNumber: string;
    tableLabel: string | null;
    orderId: string;
    stationCode: string;
    stationName: string;
    printerConfig: KdsStationPrinterConfig | null | undefined;
    roundLabel: string | null;
    orderNotes: string | null;
    lines: readonly KitchenComandaLineInput[];
    now: string;
  }
): string[] {
  if (!hasActiveStationPrinter(args.printerConfig) || args.lines.length === 0) return [];
  const actor = tx
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, args.actorId), eq(users.tenantId, args.tenantId)))
    .get();
  const document = buildKitchenComandaDocument({
    stationName: args.stationName,
    stationCode: args.stationCode,
    tableLabel: args.tableLabel,
    saleNumber: args.saleNumber,
    roundLabel: args.roundLabel,
    waiterName: actor?.name ?? null,
    timestampIso: args.now,
    lines: args.lines,
    orderNotes: args.orderNotes,
  });
  return insertComandaOutboxJob(tx, {
    tenantId: args.tenantId,
    siteId: args.siteId,
    saleId: args.saleId,
    stationCode: args.stationCode,
    stationName: args.stationName,
    orderId: args.orderId,
    ticketKind: 'order',
    printerConfig: args.printerConfig,
    document,
    idempotencyBase: `kds-comanda:${args.orderId}`,
    now: args.now,
  });
}

/**
 * Enqueue ESC/POS void tickets when submitted KDS lines are cancelled or discarded.
 */
export function enqueueStationVoidTicketInTransaction(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    actorId: string;
    saleId: string;
    saleNumber: string;
    tableLabel: string | null;
    orderId: string;
    stationCode: string;
    stationName: string;
    eventSequence: number;
    reason: 'discard' | 'void';
    lines: ReadonlyArray<{
      productName: string;
      quantity: number;
      dinerLabel?: string | null | undefined;
    }>;
    now: string;
  }
): string[] {
  if (args.lines.length === 0) return [];
  const station = tx
    .select({ printerConfig: kdsStations.printerConfig })
    .from(kdsStations)
    .where(
      and(
        eq(kdsStations.tenantId, args.tenantId),
        eq(kdsStations.siteId, args.siteId),
        eq(kdsStations.code, args.stationCode)
      )
    )
    .get();
  if (!hasActiveStationPrinter(station?.printerConfig)) return [];

  const actor = tx
    .select({ name: users.name })
    .from(users)
    .where(and(eq(users.id, args.actorId), eq(users.tenantId, args.tenantId)))
    .get();
  const document = buildKitchenVoidDocument({
    stationName: args.stationName,
    stationCode: args.stationCode,
    tableLabel: args.tableLabel,
    saleNumber: args.saleNumber,
    actorName: actor?.name ?? null,
    reason: args.reason,
    timestampIso: args.now,
    lines: args.lines,
  });
  return insertComandaOutboxJob(tx, {
    tenantId: args.tenantId,
    siteId: args.siteId,
    saleId: args.saleId,
    stationCode: args.stationCode,
    stationName: args.stationName,
    orderId: args.orderId,
    ticketKind: 'void',
    printerConfig: station.printerConfig,
    document,
    idempotencyBase: `kds-void:${args.orderId}:seq-${args.eventSequence}`,
    now: args.now,
  });
}

/** Helper to look up station printer configs in bulk for a list of station codes. */
export function loadStationPrinterConfigs(
  tx: DatabaseInstance,
  tenantId: string,
  siteId: string,
  stationCodes: readonly string[]
): Map<string, KdsStationPrinterConfig | null> {
  if (stationCodes.length === 0) return new Map();
  const rows = tx
    .select({ code: kdsStations.code, printerConfig: kdsStations.printerConfig })
    .from(kdsStations)
    .where(
      and(
        eq(kdsStations.tenantId, tenantId),
        eq(kdsStations.siteId, siteId),
        inArray(kdsStations.code, [...stationCodes])
      )
    )
    .all();
  return new Map(rows.map(row => [row.code, row.printerConfig ?? null]));
}
