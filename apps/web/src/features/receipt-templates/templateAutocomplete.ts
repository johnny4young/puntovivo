/**
 * Receipt template autocomplete (ENG-016 pass 4).
 *
 * Wires a CodeMirror 6 `CompletionSource` to the receipt template
 * grammar. The source inspects the document around the cursor, decides
 * whether the cursor is inside a `{{ ... }}` substitution, and emits
 * suggestions of three flavours:
 *
 *   1. Right after `{{` with no dot yet → the 5 allowed namespaces
 *      plus the 12 whitelisted function names (each tagged so CM6
 *      colors the badge).
 *   2. After a `.` following a known namespace → only that namespace's
 *      documented properties.
 *   3. Inside a function-call argument → still surfaces namespaces +
 *      properties so nested `{{ currency(sale.| ) }}` works.
 *
 * The function catalog mirrors `FUNCTION_REGISTRY` in
 * `packages/server/src/services/template-expression.ts`. A parity
 * sanity-check (in `templateAutocomplete.test.ts`) compares the two
 * arrays so adding a function to the server registry without touching
 * the editor catalog fails CI immediately.
 *
 * The property catalog mirrors the variable whitelist documented in
 * `docs/RECEIPT-TEMPLATES.md` §Whitelist of variables — there is no
 * runtime contract on the server side that pins these (the renderer's
 * `lookupPath` is permissive), so this catalog is the single source of
 * truth for what the editor offers as autocomplete.
 *
 * @module features/receipt-templates/templateAutocomplete
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

export const TEMPLATE_NAMESPACES = [
  'company',
  'sale',
  'item',
  'fiscal',
  'tender',
] as const;

export type TemplateNamespace = (typeof TEMPLATE_NAMESPACES)[number];

/**
 * Property catalog per namespace. Mirrors the documented variable
 * whitelist; keep in sync with `docs/RECEIPT-TEMPLATES.md` §Whitelist
 * of variables and with `RenderData` in the renderer.
 */
export const NAMESPACE_PROPERTIES: Record<TemplateNamespace, readonly string[]> = {
  company: ['name', 'taxId', 'address', 'phone', 'email', 'city'],
  sale: [
    'saleNumber',
    'cashier',
    'site',
    'customer',
    'customerTaxId',
    'createdAt',
    'subtotal',
    'discount',
    'taxTotal',
    'tip',
    'grandTotal',
    'changeDue',
    'notes',
  ],
  item: ['name', 'sku', 'qty', 'unitPrice', 'taxPercent', 'discount', 'total'],
  fiscal: ['cufe', 'qrUrl', 'resolution', 'documentNumber'],
  tender: ['method', 'amount', 'reference'],
};

/**
 * Function names mirror FUNCTION_REGISTRY in
 * `packages/server/src/services/template-expression.ts`. Adding a
 * function on the server without updating this list still works at
 * save time (Zod validates), but the editor will not surface it in
 * autocomplete. The parity test in `templateAutocomplete.test.ts`
 * detects drift.
 */
export const TEMPLATE_FUNCTION_NAMES = [
  'currency',
  'date',
  'upper',
  'lower',
  'round',
  'limit',
  'concat',
  'default',
  'abs',
  'max',
  'min',
  'sum',
] as const;

// ---------------------------------------------------------------------------
// Cursor inspection
// ---------------------------------------------------------------------------

export interface ActiveSubstitution {
  /** Position of the `{{` opener in the document. */
  start: number;
  /** Position right after `{{`. */
  innerStart: number;
  /** Position of the next `}}` boundary or end-of-document. */
  innerEnd: number;
  /** Substring between `{{` and `}}` (or end-of-document if unterminated). */
  inner: string;
  /** True when no `}}` has appeared yet between `{{` and cursor / EOF. */
  unterminated: boolean;
}

/**
 * Returns the `{{ ... }}` block containing `cursor` (if any).
 *
 * Tolerates unterminated substitutions (cursor right after `{{` with
 * no closing `}}` yet) by treating end-of-document as the boundary.
 */
export function getActiveSubstitution(
  text: string,
  cursor: number
): ActiveSubstitution | null {
  // Find the last `{{` at or before cursor.
  const openerIdx = text.lastIndexOf('{{', Math.max(0, cursor - 1));
  if (openerIdx === -1) return null;

  // Find the next `}}` at or after the opener.
  const closerIdx = text.indexOf('}}', openerIdx + 2);

  // If the opener is followed by a closer that is BEFORE the cursor,
  // the cursor is outside this substitution.
  if (closerIdx !== -1 && closerIdx + 2 <= cursor) return null;

  const innerStart = openerIdx + 2;
  const innerEnd = closerIdx === -1 ? text.length : closerIdx;
  return {
    start: openerIdx,
    innerStart,
    innerEnd,
    inner: text.slice(innerStart, innerEnd),
    unterminated: closerIdx === -1,
  };
}

// ---------------------------------------------------------------------------
// Suggestion helpers
// ---------------------------------------------------------------------------

const IDENT_BODY = /[A-Za-z0-9_]/;

interface PartialToken {
  /** Document offset of the first char of the partial identifier. */
  from: number;
  /** Document offset right after the last char of the partial identifier. */
  to: number;
  /** The partial identifier text (may be empty). */
  text: string;
  /** True when the char immediately before `from` is `.`. */
  precededByDot: boolean;
  /** When `precededByDot`, the dotted prefix immediately before the dot. */
  precedingPathHead: string | null;
}

function findPartialIdentAt(text: string, cursor: number): PartialToken {
  let from = cursor;
  while (from > 0 && IDENT_BODY.test(text[from - 1] ?? '')) from--;
  const partial = text.slice(from, cursor);
  const precededByDot = from > 0 && text[from - 1] === '.';
  let precedingPathHead: string | null = null;
  if (precededByDot) {
    const headEnd = from - 1;
    let headStart = headEnd;
    while (headStart > 0 && IDENT_BODY.test(text[headStart - 1] ?? '')) headStart--;
    precedingPathHead = text.slice(headStart, headEnd);
  }
  return {
    from,
    to: cursor,
    text: partial,
    precededByDot,
    precedingPathHead,
  };
}

interface SuggestionPlan {
  from: number;
  to: number;
  options: Completion[];
}

function buildNamespaceCompletions(): Completion[] {
  return TEMPLATE_NAMESPACES.map(ns => ({
    label: ns,
    type: 'namespace',
    detail: 'namespace',
  }));
}

function buildFunctionCompletions(): Completion[] {
  return TEMPLATE_FUNCTION_NAMES.map(name => ({
    label: name,
    type: 'function',
    detail: 'fn',
    /**
     * Insert `name()` with the caret between the parens so the operator
     * can immediately type the first argument. The previous `name + '('`
     * shape left an unclosed paren that the linter (correctly) flagged
     * as `unparseable` until the user manually typed `)` — surfaced by
     * the typescript-react-reviewer skill on review.
     */
    apply: (view, _completion, from, to) => {
      const insert = `${name}()`;
      const caretAt = from + name.length + 1;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: caretAt },
        userEvent: 'input.complete',
      });
    },
  }));
}

function buildPropertyCompletions(namespace: TemplateNamespace): Completion[] {
  return NAMESPACE_PROPERTIES[namespace].map(prop => ({
    label: prop,
    type: 'property',
    detail: namespace,
  }));
}

/**
 * Pure helper used by both the CM6 source below and by direct tests.
 * Given the document text + cursor offset, returns the suggestion
 * plan or null if the cursor is not in a position that should
 * trigger autocomplete.
 */
export function planSuggestions(
  text: string,
  cursor: number
): SuggestionPlan | null {
  const sub = getActiveSubstitution(text, cursor);
  if (!sub) return null;

  // Cursor must be strictly inside the `{{ … }}` interior.
  if (cursor < sub.innerStart) return null;
  if (cursor > sub.innerEnd) return null;

  const partial = findPartialIdentAt(text, cursor);

  // Property branch: cursor right after `<knownNamespace>.<partial>`.
  if (
    partial.precededByDot &&
    partial.precedingPathHead !== null &&
    (TEMPLATE_NAMESPACES as readonly string[]).includes(partial.precedingPathHead)
  ) {
    return {
      from: partial.from,
      to: partial.to,
      options: buildPropertyCompletions(partial.precedingPathHead as TemplateNamespace),
    };
  }

  // Default branch: namespaces + functions, filtered by the partial token.
  return {
    from: partial.from,
    to: partial.to,
    options: [...buildNamespaceCompletions(), ...buildFunctionCompletions()],
  };
}

// ---------------------------------------------------------------------------
// CodeMirror 6 CompletionSource
// ---------------------------------------------------------------------------

export const templateAutocompleteSource: CompletionSource = (
  context: CompletionContext
): CompletionResult | null => {
  const text = context.state.doc.toString();
  const cursor = context.pos;

  const plan = planSuggestions(text, cursor);
  if (!plan) return null;

  // Honour the explicit-only convention: when CM6 hasn't been
  // explicitly triggered AND the partial token is empty, we still
  // surface suggestions (this is how IDE-style autocomplete inside
  // a moustache feels right). Skip only when the partial is empty
  // AND the user is not actively typing.
  if (plan.from === plan.to && !context.explicit) {
    // Allow auto-trigger when the previous char is `{` or `.` —
    // those signal the operator just opened a substitution / member
    // access and expects the dropdown.
    const before = text[cursor - 1];
    if (before !== '{' && before !== '.') return null;
  }

  return {
    from: plan.from,
    to: plan.to,
    options: plan.options,
    validFor: /^[A-Za-z0-9_]*$/,
  };
};
