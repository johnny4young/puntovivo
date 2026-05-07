/**
 * ENG-036b — CAF (Códigos de Autorización de Folios) folio allocator.
 *
 * The SII issues each emisor a signed XML CAF that authorizes
 * emission of a specific TipoDTE in a folio range
 * `[folio_desde, folio_hasta]`. This module is the atomic allocator
 * that advances the cursor.
 *
 * Two entry points:
 *
 *   - `allocateNextFolio(tx, args)` — runs INSIDE the orchestrator's
 *     write transaction so the folio advance + the
 *     `fiscal_documents` insert happen atomically. Throws
 *     `CAF_NOT_AVAILABLE` when no active CAF exists for the pair, or
 *     `CAF_EXHAUSTED` when the cursor would exceed `folio_hasta` (and
 *     atomically flips the row to `status='exhausted'` so the next
 *     CAF the operator uploads can claim the active slot).
 *   - `peekActiveCaf(db, tenantId, tipoDte)` — read-only lookup the
 *     admin tab + getActiveCaf tRPC query use to render "folios
 *     remaining" without mutating state.
 *
 * Concurrency: better-sqlite3 transactions wrap with BEGIN IMMEDIATE,
 * so concurrent allocators across separate transactions serialize
 * implicitly. Inside one transaction, the SELECT-then-UPDATE pattern
 * is safe because the SELECT carries no race with the same tx.
 *
 * @module services/fiscal/packs/cl/caf-allocator
 */

import { and, eq } from 'drizzle-orm';
import { fiscalCafs } from '../../../../db/schema.js';
import type { DatabaseInstance } from '../../../../db/index.js';
import { ServerErrorWithCode } from '../../../../lib/errorCodes.js';

/**
 * Result of a successful folio allocation. The orchestrator embeds
 * this in `FiscalAdapterIssueInput.chileAllocation` so the serializer
 * can render the `Documento.Encabezado.IdDoc.Folio` + the
 * `TED.DD.CAF` block without re-querying the DB.
 */
export interface ChileFolioAllocation {
  cafId: string;
  /** Concrete folio assigned to this emission. */
  folio: number;
  /** TipoDTE the CAF authorizes (33, 39, 61, etc). */
  tipoDte: string;
  /** RUT emisor frozen at CAF ingestion time. */
  rutEmisor: string;
  /**
   * Raw CAF XML text. The DTE serializer extracts the `<DA>` block
   * for the `Documento.TED.DD.CAF` slot and (in ENG-036c) the `<RSAPK>`
   * block for the TED RSA signature.
   */
  rawCafXml: string;
  /** Folios remaining AFTER this allocation. Useful for early "low folio" alerts. */
  rangeRemaining: number;
}

export interface PeekActiveCafResult {
  cafId: string;
  tipoDte: string;
  folioDesde: number;
  folioHasta: number;
  currentFolio: number;
  rangeRemaining: number;
  fechaAutorizacion: string;
}

interface AllocateArgs {
  tenantId: string;
  tipoDte: string;
}

/**
 * Allocate the next folio for the (tenant, tipoDte) active CAF.
 *
 * This MUST run inside a write transaction the orchestrator opened.
 * Drizzle's `.transaction(callback)` provides the tx as the first
 * argument to the callback; pass it here. better-sqlite3 wraps with
 * `BEGIN IMMEDIATE` so concurrent allocators serialize.
 *
 * Throws on:
 *   - No active CAF for (tenantId, tipoDte) → `CAF_NOT_AVAILABLE`.
 *   - Cursor exceeds `folio_hasta` → atomically flips the row to
 *     `status='exhausted'` then throws `CAF_EXHAUSTED`. The flip
 *     means the next call to `allocateNextFolio` for the same pair
 *     will surface `CAF_NOT_AVAILABLE` (because the partial unique
 *     idx no longer carries this row), letting the operator upload
 *     the next CAF.
 */
export function allocateNextFolio(
  tx: DatabaseInstance,
  args: AllocateArgs
): ChileFolioAllocation {
  const { tenantId, tipoDte } = args;

  const row = tx
    .select()
    .from(fiscalCafs)
    .where(
      and(
        eq(fiscalCafs.tenantId, tenantId),
        eq(fiscalCafs.tipoDte, tipoDte),
        eq(fiscalCafs.status, 'active')
      )
    )
    .get();

  if (!row) {
    throw new ServerErrorWithCode(
      'CAF_NOT_AVAILABLE',
      `No active CAF registered for tenant ${tenantId} + tipoDte ${tipoDte}`,
      { tenantId, tipoDte }
    );
  }

  // Defensive: under normal flow the "last folio in range" branch
  // below already flipped status to 'exhausted' on the previous
  // allocation, so this branch only fires if someone corrupted the
  // DB or pre-seeded a stale state. We do NOT flip status here
  // because the throw rolls back any same-tx side effect — the flip
  // would not persist. The operator must manually mark the row
  // exhausted via an admin path (out of scope for v1; ENG-036c
  // ships the upload UI which can take over).
  if (row.currentFolio > row.folioHasta) {
    throw new ServerErrorWithCode(
      'CAF_EXHAUSTED',
      `CAF ${row.id} exhausted: cursor ${row.currentFolio} exceeds folio_hasta ${row.folioHasta}`,
      {
        tenantId,
        tipoDte,
        cafId: row.id,
        folioHasta: row.folioHasta,
      }
    );
  }

  const folio = row.currentFolio;
  const nextCursor = folio + 1;
  const willExhaust = nextCursor > row.folioHasta;
  const now = new Date().toISOString();

  // Advance the cursor. If the allocation we just made was the LAST
  // folio in the range, atomically flip the row to 'exhausted' so
  // the next caller surfaces CAF_NOT_AVAILABLE without entering the
  // "current_folio > folio_hasta" branch (which would still throw
  // CAF_EXHAUSTED but only after an extra read).
  tx.update(fiscalCafs)
    .set({
      currentFolio: nextCursor,
      status: willExhaust ? 'exhausted' : 'active',
      updatedAt: now,
    })
    .where(eq(fiscalCafs.id, row.id))
    .run();

  return {
    cafId: row.id,
    folio,
    tipoDte: row.tipoDte,
    rutEmisor: row.rutEmisor,
    rawCafXml: row.rawXml,
    rangeRemaining: row.folioHasta - folio,
  };
}

/**
 * Read-only lookup. Returns the active CAF metadata or `null`. Does
 * NOT mutate cursor state; safe to call from the renderer's admin tab
 * read query.
 */
export function peekActiveCaf(
  db: DatabaseInstance,
  tenantId: string,
  tipoDte: string
): PeekActiveCafResult | null {
  const row = db
    .select()
    .from(fiscalCafs)
    .where(
      and(
        eq(fiscalCafs.tenantId, tenantId),
        eq(fiscalCafs.tipoDte, tipoDte),
        eq(fiscalCafs.status, 'active')
      )
    )
    .get();
  if (!row) {
    return null;
  }
  return {
    cafId: row.id,
    tipoDte: row.tipoDte,
    folioDesde: row.folioDesde,
    folioHasta: row.folioHasta,
    currentFolio: row.currentFolio,
    rangeRemaining: row.folioHasta - row.currentFolio + 1,
    fechaAutorizacion: row.fechaAutorizacion,
  };
}
