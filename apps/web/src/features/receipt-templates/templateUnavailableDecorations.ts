/**
 * Receipt template "unset variable" decorations (ENG-016 pass 5 — closes item #7).
 *
 * Adds a CodeMirror 6 Decoration layer that dims `{{namespace.field}}`
 * tokens whose path the active tenant has not configured (e.g.
 * `{{ fiscal.cufe }}` on a tenant with `fiscal_dian_enabled` off, or
 * `{{ company.email }}` when the column is null). Pure UX hint —
 * separate from `templateLinter`'s red-squiggle diagnostics for
 * SYNTAX errors. The two layers can coexist on the same token.
 *
 * Server contract: the availability map comes from
 * `trpc.receiptTemplates.variableAvailability` and is passed to the
 * editor via the `TextBlockEditor.unavailableVariables` prop.
 *
 * @module features/receipt-templates/templateUnavailableDecorations
 */

import {
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, hoverTooltip } from '@codemirror/view';
import { TEMPLATE_NAMESPACES } from './templateAutocomplete';

export type AvailabilityMap = Record<string, Record<string, boolean>>;

interface UnavailableSpan {
  /** Document offset of the path's first character. */
  from: number;
  /** Document offset right after the path's last character. */
  to: number;
  /** The dotted path (e.g. `fiscal.cufe`) — used for hover messaging. */
  path: string;
}

const NAMESPACE_SET: ReadonlySet<string> = new Set(TEMPLATE_NAMESPACES);
const IDENT_BODY = /[A-Za-z0-9_]/;

/**
 * Walk the document and return every `namespace.field` path token
 * inside `{{ … }}` substitutions whose `availability[namespace][field]`
 * is `false`. Multi-segment paths (e.g. `sale.items.0`) check only the
 * first two segments — the renderer's `lookupPath` resolves nested
 * paths but the editor's availability contract is namespace + first
 * segment only.
 */
export function findUnavailableSpans(
  text: string,
  availability: AvailabilityMap
): UnavailableSpan[] {
  const spans: UnavailableSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('{{', cursor);
    if (start === -1) break;
    const end = text.indexOf('}}', start + 2);
    const innerEnd = end === -1 ? text.length : end;
    scanInner(text, start + 2, innerEnd, availability, spans);
    cursor = end === -1 ? text.length : end + 2;
  }
  return spans;
}

function scanInner(
  text: string,
  innerStart: number,
  innerEnd: number,
  availability: AvailabilityMap,
  out: UnavailableSpan[]
): void {
  let i = innerStart;
  while (i < innerEnd) {
    const ch = text[i];
    if (ch === undefined) break;
    // Skip strings — escaped quote pairs included.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < innerEnd && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < innerEnd) {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (!IDENT_BODY.test(ch) || (ch >= '0' && ch <= '9')) {
      i++;
      continue;
    }
    // Identifier head — capture the dotted path that starts here.
    const headStart = i;
    while (i < innerEnd && IDENT_BODY.test(text[i] ?? '')) i++;
    // If the next char is `(`, this identifier is a function name, not
    // a path — skip past the function name and keep scanning args.
    if (text[i] === '(') {
      continue;
    }
    if (text[i] !== '.') {
      // Bare identifier without dot is an unparseable shape that the
      // linter handles. Skip.
      continue;
    }
    // Eat `.` then the property identifier.
    const namespace = text.slice(headStart, i);
    i++;
    const propStart = i;
    while (i < innerEnd && IDENT_BODY.test(text[i] ?? '')) i++;
    const property = text.slice(propStart, i);
    if (!NAMESPACE_SET.has(namespace) || property.length === 0) continue;
    // hasOwnProperty.call hardens against prototype-chain lookups so a
    // future caller cannot accidentally trigger `availability['__proto__']`
    // semantics. Same defense the renderer's `lookupPath` uses.
    if (!Object.prototype.hasOwnProperty.call(availability, namespace)) continue;
    const namespaceMap = availability[namespace];
    // If the namespace key is missing or null, treat as available
    // (defensive — a stale availability map should not over-dim).
    if (!namespaceMap) continue;
    if (!Object.prototype.hasOwnProperty.call(namespaceMap, property)) continue;
    if (namespaceMap[property] === false) {
      out.push({ from: headStart, to: i, path: `${namespace}.${property}` });
    }
  }
}

// ---------------------------------------------------------------------------
// CodeMirror 6 wiring
// ---------------------------------------------------------------------------

/**
 * Effect dispatched whenever the availability map changes (loaded from
 * the server, or after the operator updates company / fiscal settings
 * elsewhere in the admin app).
 */
const setAvailabilityEffect = StateEffect.define<AvailabilityMap | null>();

interface AvailabilityState {
  availability: AvailabilityMap | null;
  decorations: DecorationSet;
}

const dimDecoration = Decoration.mark({ class: 'cm-variable-unavailable' });

function buildDecorations(
  doc: string,
  availability: AvailabilityMap | null
): DecorationSet {
  if (!availability) return Decoration.none;
  const spans = findUnavailableSpans(doc, availability);
  if (spans.length === 0) return Decoration.none;
  const ranges: Range<Decoration>[] = spans.map(span =>
    dimDecoration.range(span.from, span.to)
  );
  return Decoration.set(ranges, true);
}

const availabilityField = StateField.define<AvailabilityState>({
  create: () => ({ availability: null, decorations: Decoration.none }),
  update(value, tr) {
    let availability = value.availability;
    let docChanged = tr.docChanged;
    for (const effect of tr.effects) {
      if (effect.is(setAvailabilityEffect)) {
        availability = effect.value;
        docChanged = true;
      }
    }
    if (!docChanged) return value;
    return {
      availability,
      decorations: buildDecorations(tr.state.doc.toString(), availability),
    };
  },
  provide: f => EditorView.decorations.from(f, state => state.decorations),
});

/**
 * Hover tooltip: when the cursor hovers a token inside the dimmed
 * decoration range, surface a translatable explanation. Reuses the
 * cached DecorationSet from `availabilityField` instead of re-scanning
 * the document — the StateField already holds the up-to-date set, so
 * iterating its `[pos, pos]` slice is the idiomatic CM6 path. The
 * `translate` callback comes from the editor wrapper which has access
 * to `useTranslation` — keeps this pure module i18n-agnostic.
 */
function buildHoverTooltip(translate: (key: string, params?: Record<string, string>) => string) {
  return hoverTooltip((view, pos) => {
    const state = view.state.field(availabilityField, false);
    if (!state) return null;
    let hitFrom = -1;
    let hitTo = -1;
    state.decorations.between(pos, pos, (from, to) => {
      hitFrom = from;
      hitTo = to;
      return false;
    });
    if (hitFrom === -1) return null;
    const path = view.state.doc.sliceString(hitFrom, hitTo);
    return {
      pos: hitFrom,
      end: hitTo,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-tooltip-variable-unavailable';
        dom.textContent = translate('editor.codeEditor.unavailableVariable', {
          path,
        });
        return { dom };
      },
    };
  });
}

/**
 * StateEffect helper: dispatch the availability map into the editor
 * state. The component layer calls this whenever the prop changes.
 */
export function setAvailabilityForView(
  view: EditorView,
  availability: AvailabilityMap | null
): void {
  view.dispatch({ effects: setAvailabilityEffect.of(availability) });
}

/**
 * Bundled extension factory. Adds the StateField + hover tooltip in a
 * single configuration. After mount, the wrapper updates the
 * decoration set via `setAvailabilityForView` (a `StateEffect`
 * dispatch) — no remount needed.
 */
export function buildUnavailableVariablesExtension(
  initial: AvailabilityMap | null,
  translate: (key: string, params?: Record<string, string>) => string
): Extension {
  return [
    availabilityField.init(state => ({
      availability: initial,
      decorations: buildDecorations(state.doc.toString(), initial),
    })),
    buildHoverTooltip(translate),
  ];
}

/**
 * Internal handle for tests — exposes the StateField + effect so a
 * test can drive the field directly without booting a full EditorView.
 */
export const __test = {
  availabilityField,
  setAvailabilityEffect,
  buildDecorations,
};
