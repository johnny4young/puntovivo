/**
 * Register-assignment denomination templates.
 *
 * Upserts the per-(tenant, site, register) denomination template that
 * pre-fills a cashier's opening count, and the site-level ensure that
 * backfills templates from recent session history when none exist yet.
 *
 * @module services/cash-session/registers
 */

import { and, asc, desc, eq, max } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  denominationTemplates,
  type CashSessionDenomination,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { REGISTER_ASSIGNMENT_BACKFILL_LIMIT, DEFAULT_REGISTER_NAME } from './constants.js';
import { createDefaultCashSessionDenominations, normalizeRegisterName } from './denominations.js';

async function getNextRegisterTemplateSortOrder(db: DatabaseInstance, siteId: string) {
  const [result] = await db
    .select({ value: max(denominationTemplates.sortOrder) })
    .from(denominationTemplates)
    .where(eq(denominationTemplates.siteId, siteId));

  return (result?.value ?? -1) + 1;
}

export async function ensureRegisterAssignmentTemplate(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    registerName: string;
    openingFloat: number;
    denominations: CashSessionDenomination[];
  }
) {
  const registerName = normalizeRegisterName(args.registerName);
  const existing = await db
    .select()
    .from(denominationTemplates)
    .where(
      and(
        eq(denominationTemplates.tenantId, args.tenantId),
        eq(denominationTemplates.siteId, args.siteId),
        eq(denominationTemplates.registerName, registerName)
      )
    )
    .get();

  const now = new Date().toISOString();
  const openingFloat = roundMoney(args.openingFloat);

  if (existing) {
    await db
      .update(denominationTemplates)
      .set({
        label: registerName,
        openingFloat,
        denominations: args.denominations,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(denominationTemplates.id, existing.id));

    return existing.id;
  }

  const sortOrder = await getNextRegisterTemplateSortOrder(db, args.siteId);
  const id = nanoid();

  await db.insert(denominationTemplates).values({
    id,
    tenantId: args.tenantId,
    siteId: args.siteId,
    registerName,
    label: registerName,
    openingFloat,
    denominations: args.denominations,
    sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function ensureRegisterAssignmentTemplatesForSite(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
  }
) {
  const existingTemplates = await db
    .select()
    .from(denominationTemplates)
    .where(
      and(
        eq(denominationTemplates.tenantId, args.tenantId),
        eq(denominationTemplates.siteId, args.siteId)
      )
    )
    .orderBy(asc(denominationTemplates.sortOrder), asc(denominationTemplates.label));

  // Backfill templates from historical sessions only when no templates exist.
  // Once templates are seeded, `open` keeps them in sync via
  // `ensureRegisterAssignmentTemplate`, so rescanning session history on every
  // POS page load would be wasted work.
  if (existingTemplates.length === 0) {
    const knownRegisterNames = new Set<string>();
    const recentRegisterSessions = await db
      .select({
        registerName: cashSessions.registerName,
        openingFloat: cashSessions.openingFloat,
        denominations: cashSessions.openingCountDenominations,
      })
      .from(cashSessions)
      .where(and(eq(cashSessions.tenantId, args.tenantId), eq(cashSessions.siteId, args.siteId)))
      .orderBy(desc(cashSessions.openedAt))
      .limit(REGISTER_ASSIGNMENT_BACKFILL_LIMIT);

    for (const session of recentRegisterSessions) {
      const registerName = normalizeRegisterName(session.registerName);

      if (knownRegisterNames.has(registerName)) {
        continue;
      }

      knownRegisterNames.add(registerName);
      await ensureRegisterAssignmentTemplate(db, {
        tenantId: args.tenantId,
        siteId: args.siteId,
        registerName,
        openingFloat: session.openingFloat,
        denominations: session.denominations,
      });
    }

    if (knownRegisterNames.size === 0) {
      await ensureRegisterAssignmentTemplate(db, {
        tenantId: args.tenantId,
        siteId: args.siteId,
        registerName: DEFAULT_REGISTER_NAME,
        openingFloat: 0,
        denominations: createDefaultCashSessionDenominations(),
      });
    }
  }

  return db
    .select()
    .from(denominationTemplates)
    .where(
      and(
        eq(denominationTemplates.tenantId, args.tenantId),
        eq(denominationTemplates.siteId, args.siteId),
        eq(denominationTemplates.isActive, true)
      )
    )
    .orderBy(asc(denominationTemplates.sortOrder), asc(denominationTemplates.label));
}
