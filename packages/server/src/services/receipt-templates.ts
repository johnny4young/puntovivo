/**
 * Receipt Template Service (Iter 2 — declarative editor + pure renderer).
 *
 * The service owns persistence + the "one default per (tenant, kind)"
 * invariant. Default flips run inside a SQLite transaction so the old
 * default and the new default never both hold `is_default = 1`
 * simultaneously, even under concurrent admins. This complements the
 * partial unique index in the raw DDL mirror (which would otherwise
 * fail the second insert with a constraint violation — the transaction
 * makes the failure mode "first writer wins" predictably).
 *
 * @module services/receipt-templates
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  receiptTemplates,
  type ReceiptTemplate,
  type ReceiptTemplateKind,
  type ReceiptTemplatePaperWidth,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import {
  receiptLayoutSchema,
  type ReceiptLayout,
} from '../trpc/schemas/receiptTemplates.js';

function nowIso(): string {
  return new Date().toISOString();
}

function serializeLayout(layout: ReceiptLayout): Record<string, unknown> {
  return JSON.parse(JSON.stringify(layout)) as Record<string, unknown>;
}

export interface ReceiptTemplateRecord {
  id: string;
  tenantId: string;
  kind: ReceiptTemplateKind;
  name: string;
  paperWidth: ReceiptTemplatePaperWidth;
  layout: ReceiptLayout;
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: ReceiptTemplate): ReceiptTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as ReceiptTemplateKind,
    name: row.name,
    paperWidth: row.paperWidth as ReceiptTemplatePaperWidth,
    layout: receiptLayoutSchema.parse(row.layout),
    isDefault: row.isDefault ?? false,
    isActive: row.isActive ?? true,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ENG-179b — explicit `| undefined` so the tRPC router can forward
// Zod-optional flag fields.
export interface CreateReceiptTemplateArgs {
  tenantId: string;
  kind: ReceiptTemplateKind;
  name: string;
  layout: ReceiptLayout;
  isDefault?: boolean | undefined;
  isActive?: boolean | undefined;
  createdBy: string;
}

/**
 * Insert a new template. If `isDefault` is true, demote any existing
 * default for the same `(tenantId, kind)` in the same transaction so the
 * invariant holds. If no template exists yet for this kind, the new one
 * is silently promoted to default regardless of input — empty kind +
 * non-default would leave the tenant with no rendering target.
 */
export function createReceiptTemplate(
  db: DatabaseInstance,
  args: CreateReceiptTemplateArgs
): ReceiptTemplateRecord {
  return db.transaction(tx => {
    const existing = tx
      .select({ id: receiptTemplates.id, isDefault: receiptTemplates.isDefault })
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.tenantId, args.tenantId),
          eq(receiptTemplates.kind, args.kind)
        )
      )
      .all();

    const requestedDefault = args.isDefault ?? false;
    const shouldBeDefault = requestedDefault || existing.length === 0;

    if (shouldBeDefault) {
      tx
        .update(receiptTemplates)
        .set({ isDefault: false, updatedAt: nowIso() })
        .where(
          and(
            eq(receiptTemplates.tenantId, args.tenantId),
            eq(receiptTemplates.kind, args.kind),
            eq(receiptTemplates.isDefault, true)
          )
        )
        .run();
    }

    const id = nanoid();
    const now = nowIso();
    tx
      .insert(receiptTemplates)
      .values({
        id,
        tenantId: args.tenantId,
        kind: args.kind,
        name: args.name,
        paperWidth: args.layout.paperWidth,
        layout: serializeLayout(args.layout),
        isDefault: shouldBeDefault,
        isActive: args.isActive ?? true,
        createdBy: args.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = tx
      .select()
      .from(receiptTemplates)
      .where(eq(receiptTemplates.id, id))
      .get();

    if (!created) {
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'RECEIPT_TEMPLATE_PERSIST_FAILED',
        message: 'Receipt template insert returned no row',
        details: { tenantId: args.tenantId, templateId: id, operation: 'insert' },
      });
    }
    return toRecord(created);
  });
}

export interface UpdateReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
  // ENG-179b — explicit `| undefined` on Zod-optional fields.
  name?: string | undefined;
  layout?: ReceiptLayout | undefined;
  isActive?: boolean | undefined;
  actorId: string;
}

export function updateReceiptTemplate(
  db: DatabaseInstance,
  args: UpdateReceiptTemplateArgs
): ReceiptTemplateRecord {
  return db.transaction(tx => {
    const existing = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.id, args.templateId),
          eq(receiptTemplates.tenantId, args.tenantId)
        )
      )
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    if (args.isActive === false && existing.isDefault) {
      // Cannot deactivate the active default — the tenant would lose its
      // rendering target for that kind.
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
        message:
          'Cannot deactivate the default template for this kind; promote another template to default first',
        details: { templateId: args.templateId, kind: existing.kind },
      });
    }

    tx
      .update(receiptTemplates)
      .set({
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.layout !== undefined
          ? {
              layout: serializeLayout(args.layout),
              paperWidth: args.layout.paperWidth,
            }
          : {}),
        ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
        updatedBy: args.actorId,
        updatedAt: nowIso(),
      })
      .where(eq(receiptTemplates.id, args.templateId))
      .run();

    const updated = tx
      .select()
      .from(receiptTemplates)
      .where(eq(receiptTemplates.id, args.templateId))
      .get();

    if (!updated) {
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'RECEIPT_TEMPLATE_PERSIST_FAILED',
        message: 'Receipt template update returned no row',
        details: { tenantId: args.tenantId, templateId: args.templateId, operation: 'update' },
      });
    }
    return toRecord(updated);
  });
}

export interface DeleteReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
}

export function deleteReceiptTemplate(
  db: DatabaseInstance,
  args: DeleteReceiptTemplateArgs
): { id: string } {
  return db.transaction(tx => {
    const existing = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.id, args.templateId),
          eq(receiptTemplates.tenantId, args.tenantId)
        )
      )
      .get();

    if (!existing) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    // Refuse to delete the last ACTIVE template for a kind — the
    // tenant would be left without a default rendering target. We only
    // count active siblings here (and the fallback promotion below
    // also requires `is_active = true`); counting inactive rows would
    // let an operator delete the active default when only inactive
    // siblings remain, leaving the kind silently with no usable
    // default. Operators can still mark a row inactive via `update` if
    // they want it hidden, but the invariant "every kind that has any
    // active template has a default" must hold so the renderer always
    // has something to fall back to.
    const activeSiblings = tx
      .select({
        id: receiptTemplates.id,
        isDefault: receiptTemplates.isDefault,
      })
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.tenantId, args.tenantId),
          eq(receiptTemplates.kind, existing.kind),
          eq(receiptTemplates.isActive, true)
        )
      )
      .all();

    // Allow deleting an inactive sibling even when no active ones
    // exist — the constraint only matters when removing an active
    // template. An inactive deletion never invalidates the default
    // invariant because inactive rows cannot be the default.
    const removingActiveLastOne =
      existing.isActive && activeSiblings.length <= 1;

    if (removingActiveLastOne) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
        message:
          'Cannot delete the only active template for this kind; create or activate a replacement first',
        details: { templateId: args.templateId, kind: existing.kind },
      });
    }

    tx
      .delete(receiptTemplates)
      .where(eq(receiptTemplates.id, args.templateId))
      .run();

    // If the deleted row was the default, promote the most recently
    // updated remaining sibling to default so the kind still has one.
    if (existing.isDefault) {
      const fallback = tx
        .select({ id: receiptTemplates.id })
        .from(receiptTemplates)
        .where(
          and(
            eq(receiptTemplates.tenantId, args.tenantId),
            eq(receiptTemplates.kind, existing.kind),
            eq(receiptTemplates.isActive, true)
          )
        )
        .orderBy(desc(receiptTemplates.updatedAt))
        .get();

      if (fallback) {
        tx
          .update(receiptTemplates)
          .set({ isDefault: true, updatedAt: nowIso() })
          .where(eq(receiptTemplates.id, fallback.id))
          .run();
      }
    }

    return { id: args.templateId };
  });
}

export interface SetDefaultReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
}

/**
 * Promote the given template to default for its kind. Demotes the prior
 * default within the same transaction so both updates land atomically
 * — no window where both are true (would violate the partial unique
 * index) and no window where neither is true.
 */
export function setDefaultReceiptTemplate(
  db: DatabaseInstance,
  args: SetDefaultReceiptTemplateArgs
): ReceiptTemplateRecord {
  return db.transaction(tx => {
    const target = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.id, args.templateId),
          eq(receiptTemplates.tenantId, args.tenantId)
        )
      )
      .get();

    if (!target) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    if (!target.isActive) {
      // Promoting an inactive template is nonsensical — the renderer
      // would skip it. Force the operator to reactivate first.
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
        message:
          'Cannot promote an inactive template to default; activate it first',
        details: { templateId: args.templateId },
      });
    }

    if (target.isDefault) {
      // Idempotent: already default. Return as-is so callers can use this
      // procedure as a "make sure X is default" without branching.
      return toRecord(target);
    }

    tx
      .update(receiptTemplates)
      .set({ isDefault: false, updatedAt: nowIso() })
      .where(
        and(
          eq(receiptTemplates.tenantId, args.tenantId),
          eq(receiptTemplates.kind, target.kind),
          eq(receiptTemplates.isDefault, true)
        )
      )
      .run();

    tx
      .update(receiptTemplates)
      .set({ isDefault: true, updatedAt: nowIso() })
      .where(eq(receiptTemplates.id, args.templateId))
      .run();

    const refreshed = tx
      .select()
      .from(receiptTemplates)
      .where(eq(receiptTemplates.id, args.templateId))
      .get();

    if (!refreshed) {
      throwServerError({
        trpcCode: 'INTERNAL_SERVER_ERROR',
        errorCode: 'RECEIPT_TEMPLATE_PERSIST_FAILED',
        message: 'Receipt template setDefault returned no row',
        details: { tenantId: args.tenantId, templateId: args.templateId, operation: 'setDefault' },
      });
    }
    return toRecord(refreshed);
  });
}

export interface DuplicateReceiptTemplateArgs {
  tenantId: string;
  templateId: string;
  // ENG-179b — explicit `| undefined` on Zod-optional field.
  name?: string | undefined;
  actorId: string;
}

export function duplicateReceiptTemplate(
  db: DatabaseInstance,
  args: DuplicateReceiptTemplateArgs
): ReceiptTemplateRecord {
  // Wrap the read + insert in a single transaction so a concurrent
  // delete cannot remove the source after we've copied its layout but
  // before we've written the duplicate. Better-sqlite3 nests
  // transactions safely; the inner `createReceiptTemplate` call
  // joins this same SAVEPOINT.
  return db.transaction(tx => {
    const source = tx
      .select()
      .from(receiptTemplates)
      .where(
        and(
          eq(receiptTemplates.id, args.templateId),
          eq(receiptTemplates.tenantId, args.tenantId)
        )
      )
      .get();

    if (!source) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'RECEIPT_TEMPLATE_NOT_FOUND',
        message: 'Receipt template not found',
        details: { templateId: args.templateId },
      });
    }

    const duplicateName = args.name?.trim() || `${source.name} (copy)`;

    return createReceiptTemplate(tx, {
      tenantId: args.tenantId,
      kind: source.kind as ReceiptTemplateKind,
      name: duplicateName,
      layout: receiptLayoutSchema.parse(source.layout),
      // Duplicates never inherit `isDefault` — promoting requires an
      // explicit `setDefault`. Avoids surprising the operator who
      // clicks "duplicate" expecting a copy and getting a silent
      // default-flip.
      isDefault: false,
      isActive: source.isActive ?? true,
      createdBy: args.actorId,
    });
  });
}

// ENG-179b — explicit `| undefined` on Zod-optional filter fields.
export interface ListReceiptTemplatesOptions {
  kind?: ReceiptTemplateKind | undefined;
  includeInactive?: boolean | undefined;
  limit?: number | undefined;
}

export function listReceiptTemplates(
  db: DatabaseInstance,
  tenantId: string,
  options: ListReceiptTemplatesOptions = {}
): ReceiptTemplateRecord[] {
  const conditions = [eq(receiptTemplates.tenantId, tenantId)];
  if (options.kind) {
    conditions.push(eq(receiptTemplates.kind, options.kind));
  }
  if (!options.includeInactive) {
    conditions.push(eq(receiptTemplates.isActive, true));
  }

  const rows = db
    .select()
    .from(receiptTemplates)
    .where(and(...conditions))
    .orderBy(
      // Defaults first, then by name, so the list reads naturally for an
      // admin scanning a kind.
      desc(receiptTemplates.isDefault),
      asc(receiptTemplates.name),
      desc(receiptTemplates.updatedAt)
    )
    .limit(Math.max(1, Math.min(options.limit ?? 100, 200)))
    .all();

  return rows.map(toRecord);
}

export function getReceiptTemplateById(
  db: DatabaseInstance,
  tenantId: string,
  templateId: string
): ReceiptTemplateRecord | null {
  const row = db
    .select()
    .from(receiptTemplates)
    .where(
      and(
        eq(receiptTemplates.tenantId, tenantId),
        eq(receiptTemplates.id, templateId)
      )
    )
    .get();
  return row ? toRecord(row) : null;
}
