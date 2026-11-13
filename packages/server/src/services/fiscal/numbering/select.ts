/**
 * Which numbering range a fiscal document draws its consecutive from.
 *
 * One active range per site, kind and environment (enforced by a partial
 * unique index). When it runs out or expires, the oldest scheduled range that
 * is already in force takes over inside the caller's write transaction.
 *
 * @module services/fiscal/numbering/select
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  fiscalNumberingResolutions,
  tenants,
  type FiscalDocumentKind,
  type FiscalNumberingEnvironment,
} from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { writeAuditLog } from '../../audit-logs.js';
import { checkResolutionUsable } from '../orchestrator/helpers.js';
import { readCoFiscalSettings } from '../packs/co/settings.js';

/** A full `fiscal_numbering_resolutions` row. */
export type NumberingRange = typeof fiscalNumberingResolutions.$inferSelect;

/** Why no range can issue the next consecutive. Same codes the intent path records. */
export type NumberingUnavailableReason =
  | 'numbering_resolution_missing'
  | 'numbering_resolution_exhausted'
  | 'numbering_resolution_not_effective';

/**
 * Outcome of a range lookup. `relievedRangeId` is set when the active range
 * was (or, for a peek, would be) replaced by a scheduled one.
 */
export type NumberingSelection =
  | { ok: true; range: NumberingRange; relievedRangeId: string | null }
  | {
      ok: false;
      reason: NumberingUnavailableReason;
      details: Record<string, unknown>;
      range: NumberingRange | null;
    };

/** Coordinates of a lookup. `at` is the document's issue timestamp (ISO). */
export interface NumberingLookup {
  tenantId: string;
  siteId: string;
  kind: FiscalDocumentKind;
  environment: FiscalNumberingEnvironment;
  at: string;
}

/** Ranges are DIAN authorizations, so the tenant's Colombian environment decides which apply. */
export function numberingEnvironmentFromSettings(
  settings: Record<string, unknown> | null | undefined
): FiscalNumberingEnvironment {
  return readCoFiscalSettings(settings).environment;
}

export function readTenantNumberingEnvironment(
  db: DatabaseInstance,
  tenantId: string
): FiscalNumberingEnvironment {
  const row = db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return numberingEnvironmentFromSettings((row?.settings ?? {}) as Record<string, unknown>);
}

function scopeOf(lookup: NumberingLookup) {
  return and(
    eq(fiscalNumberingResolutions.tenantId, lookup.tenantId),
    eq(fiscalNumberingResolutions.siteId, lookup.siteId),
    eq(fiscalNumberingResolutions.kind, lookup.kind),
    eq(fiscalNumberingResolutions.environment, lookup.environment)
  );
}

function missesTechnicalKey(range: NumberingRange): boolean {
  return range.kind === 'FEV' && !range.technicalKey;
}

function terminalStatusOf(range: NumberingRange, at: string): 'exhausted' | 'expired' | null {
  if (range.currentNumber >= range.toNumber) return 'exhausted';
  const requested = Date.parse(at);
  const until = Date.parse(range.validUntil);
  if (Number.isFinite(requested) && Number.isFinite(until) && requested > until) return 'expired';
  return null;
}

interface Plan {
  selection: NumberingSelection;
  retire: { range: NumberingRange; status: 'exhausted' | 'expired' } | null;
  promote: NumberingRange | null;
}

function plan(db: DatabaseInstance, lookup: NumberingLookup): Plan {
  const active = db
    .select()
    .from(fiscalNumberingResolutions)
    .where(and(scopeOf(lookup), eq(fiscalNumberingResolutions.status, 'active')))
    .get();

  let failure: Extract<NumberingSelection, { ok: false }> = {
    ok: false,
    reason: 'numbering_resolution_missing',
    details: { siteId: lookup.siteId, kind: lookup.kind, environment: lookup.environment },
    range: null,
  };
  let terminal: 'exhausted' | 'expired' | null = null;
  if (active && missesTechnicalKey(active)) {
    // Issuing would advance the cursor for a document the provider must refuse.
    failure = {
      ...failure,
      details: { ...failure.details, technicalKey: 'missing' },
      range: active,
    };
    return { selection: failure, retire: null, promote: null };
  }
  if (active) {
    const usability = checkResolutionUsable(active, lookup.at);
    if (usability.ok) {
      return {
        selection: { ok: true, range: active, relievedRangeId: null },
        retire: null,
        promote: null,
      };
    }
    failure = { ok: false, reason: usability.reason, details: usability.details, range: active };
    terminal = terminalStatusOf(active, lookup.at);
    // Not yet in force, or a corrupt cursor: nothing to relieve.
    if (terminal === null) return { selection: failure, retire: null, promote: null };
  }

  // Dates are compared in JS: stored values mix date-only and full ISO forms.
  const successor = db
    .select()
    .from(fiscalNumberingResolutions)
    .where(and(scopeOf(lookup), eq(fiscalNumberingResolutions.status, 'scheduled')))
    .orderBy(asc(fiscalNumberingResolutions.createdAt), asc(fiscalNumberingResolutions.id))
    .all()
    .find(
      candidate => !missesTechnicalKey(candidate) && checkResolutionUsable(candidate, lookup.at).ok
    );
  if (!successor) return { selection: failure, retire: null, promote: null };
  return {
    selection: {
      ok: true,
      range: { ...successor, status: 'active', isActive: true },
      relievedRangeId: active?.id ?? null,
    },
    retire: active && terminal ? { range: active, status: terminal } : null,
    promote: successor,
  };
}

/** Read-only answer to "could a document be numbered now?". Never writes. */
export function peekNumberingRange(
  db: DatabaseInstance,
  lookup: NumberingLookup
): NumberingSelection {
  return plan(db, lookup).selection;
}

/**
 * Pick the range for the next consecutive and apply any relief: the spent
 * range is closed and its successor promoted in `tx`, with an audit row. Call
 * it inside the write transaction that advances `current_number`, so the
 * relief commits or rolls back with the document.
 */
export function selectNumberingRange(
  tx: DatabaseInstance,
  lookup: NumberingLookup & { actorId: string }
): NumberingSelection {
  const { selection, retire, promote } = plan(tx, lookup);
  if (!selection.ok || !promote) return selection;

  const now = new Date().toISOString();
  if (retire) {
    const closed = tx
      .update(fiscalNumberingResolutions)
      .set({ status: retire.status, isActive: false, updatedAt: now })
      .where(
        and(
          eq(fiscalNumberingResolutions.id, retire.range.id),
          eq(fiscalNumberingResolutions.tenantId, lookup.tenantId),
          eq(fiscalNumberingResolutions.status, 'active')
        )
      )
      .run();
    if (closed.changes !== 1) relievedConcurrently(retire.range.id);
  }
  const promoted = tx
    .update(fiscalNumberingResolutions)
    .set({ status: 'active', isActive: true, updatedAt: now })
    .where(
      and(
        eq(fiscalNumberingResolutions.id, promote.id),
        eq(fiscalNumberingResolutions.tenantId, lookup.tenantId),
        eq(fiscalNumberingResolutions.status, 'scheduled')
      )
    )
    .run();
  if (promoted.changes !== 1) relievedConcurrently(promote.id);

  writeAuditLog({
    tx,
    tenantId: lookup.tenantId,
    actorId: lookup.actorId,
    action: 'fiscal_numbering.relieve',
    resourceType: 'fiscal_numbering_range',
    resourceId: promote.id,
    before: retire ? { rangeId: retire.range.id, status: 'active' } : null,
    after: {
      rangeId: promote.id,
      status: 'active',
      ...(retire ? { relievedRangeId: retire.range.id, relievedStatus: retire.status } : {}),
    },
    metadata: { siteId: lookup.siteId, kind: lookup.kind, environment: lookup.environment },
  });
  return { ...selection, range: { ...selection.range, updatedAt: now } };
}

function relievedConcurrently(rangeId: string): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
    message: 'Fiscal numbering range changed while it was being relieved',
    details: { resolutionId: rangeId },
  });
}
