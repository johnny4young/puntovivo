// Shared input/option types for the table export service ( slice 30).

export interface ExportColumn<T = unknown> {
  /** Column key/accessor */
  key: string;
  /** Display header for the column */
  header: string;
  /** Optional formatter function for cell values */
  formatter?: (value: unknown, row: T) => string;
}

// explicit `| undefined` on optional fields.
export interface ExportOptions {
  /** Title for the export (used in PDF/Excel headers) */
  title?: string | undefined;
  /** Include timestamp in filename */
  includeTimestamp?: boolean | undefined;
  /** Date format for timestamps */
  dateFormat?: string | undefined;
}

/**
 * Semantic filename builder. Resolves the canonical
 * `<kind>-<context>-<date|id>.<ext>` pattern so every surface that
 * downloads an artifact picks a name the operator can recognise after
 * download. Anchors the convention before the settlement statement
 * downloads of  land — when those arrive, they only have to
 * import `'statement'` from this union without re-deciding the shape.
 *
 * The builder routes the final string through `generateFilename` so
 * the same accent / punctuation / casing normalisation rules apply
 * regardless of which kind the caller picked.
 */
export type SemanticExportKind =
  | {
      kind: 'statement';
      /** Provider slug (e.g. `wompi`, `nequi`). */
      provider: string;
      /** ISO date — start of the statement window. */
      from: string;
      /** ISO date — end of the statement window (inclusive). */
      to: string;
    }
  | {
      kind: 'ledger';
      /** Customer display name or business name. */
      customer: string;
      /** Optional tax id appended to the filename to disambiguate. */
      taxId?: string | null;
      /** ISO date the statement was generated at. */
      date: string;
    }
  | {
      kind: 'diagnostic';
      /** Tenant slug. */
      tenant: string;
      /** ISO timestamp the bundle was generated at. */
      timestamp: string;
    }
  | {
      kind: 'fiscal';
      /** Two-letter country code (`co`, `mx`, `cl`, ...). */
      country: string;
      /** Document folio / consecutive identifier. */
      documentNumber: string;
    }
  | {
      kind: 'report';
      /** Free-form report name (e.g. `sales-history`, `cash-close`). */
      name: string;
      /** ISO date appended to the filename. */
      date: string;
    };
