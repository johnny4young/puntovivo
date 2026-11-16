/**
 * Store-configured transfer handles (Bre-B key, Nequi or Daviplata number)
 * shown to the customer at checkout. Kept in `tenants.settings.transferHandles`,
 * outside `settings.payments`, whose keys are provider rail ids.
 *
 * @module services/payments/transfer-handles
 */
import { eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { tenants } from '../../db/schema.js';

export const TRANSFER_HANDLE_KINDS = ['breb', 'nequi', 'daviplata', 'bank', 'other'] as const;
export type TransferHandleKind = (typeof TRANSFER_HANDLE_KINDS)[number];

export const TRANSFER_HANDLES_MAX = 4;
export const TRANSFER_HANDLE_VALUE_MAX = 80;
export const TRANSFER_QR_PAYLOAD_MAX = 512;

export interface TransferHandle {
  kind: TransferHandleKind;
  value: string;
}

export interface TransferHandleSettings {
  handles: TransferHandle[];
  /** Full QR content issued by the bank; when absent the QR carries the first handle. */
  qrPayload: string | null;
}

type DbOrTx = Pick<DatabaseInstance, 'select' | 'update'>;

function isKind(value: unknown): value is TransferHandleKind {
  return TRANSFER_HANDLE_KINDS.includes(value as TransferHandleKind);
}

/** Tolerant read: a malformed stored blob degrades to nothing configured. */
export function normalizeTransferHandleSettings(raw: unknown): TransferHandleSettings {
  const blob =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const handles: TransferHandle[] = [];
  for (const entry of Array.isArray(blob.handles) ? blob.handles : []) {
    if (handles.length >= TRANSFER_HANDLES_MAX) break;
    const candidate = entry as Partial<TransferHandle> | null;
    const value = typeof candidate?.value === 'string' ? candidate.value.trim() : '';
    if (!isKind(candidate?.kind) || !value) continue;
    handles.push({ kind: candidate.kind, value: value.slice(0, TRANSFER_HANDLE_VALUE_MAX) });
  }
  const qrPayload =
    typeof blob.qrPayload === 'string' && blob.qrPayload.trim()
      ? blob.qrPayload.trim().slice(0, TRANSFER_QR_PAYLOAD_MAX)
      : null;
  return { handles, qrPayload };
}

function readSettingsBlob(db: DbOrTx, tenantId: string): Record<string, unknown> {
  const row = db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return (row?.settings ?? {}) as Record<string, unknown>;
}

export function resolveTransferHandleSettings(
  db: DbOrTx,
  tenantId: string
): TransferHandleSettings {
  return normalizeTransferHandleSettings(readSettingsBlob(db, tenantId).transferHandles);
}

export function writeTransferHandleSettings(
  db: DbOrTx,
  tenantId: string,
  next: TransferHandleSettings
): TransferHandleSettings {
  const normalized = normalizeTransferHandleSettings(next);
  const settings = { ...readSettingsBlob(db, tenantId), transferHandles: normalized };
  db.update(tenants)
    .set({ settings, updatedAt: new Date().toISOString() })
    .where(eq(tenants.id, tenantId))
    .run();
  return normalized;
}

/** What the checkout QR encodes, or null when nothing is configured. */
export function transferQrSource(settings: TransferHandleSettings): string | null {
  return settings.qrPayload ?? settings.handles[0]?.value ?? null;
}
