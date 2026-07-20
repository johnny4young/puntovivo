/**
 * HTML sanitiser for the `print-receipt` IPC handler — .
 *
 * The renderer hands the main process a fully composed receipt HTML
 * document via `ipcRenderer.invoke('print-receipt', html)`. The main
 * process then loads that HTML into an ephemeral, sandboxed
 * BrowserWindow and calls `webContents.print()`. The renderer is
 * trusted today, but the IPC trust boundary is the place where the
 * receipt could pick up untrusted content (e.g. a customer-name field
 * with an embedded `<script>`, a future template that emits operator
 * HTML, or a corrupted in-memory copy). Stripping unsafe constructs at
 * the boundary kills the class of attack outright.
 *
 * What stays:
 * - Block + inline structural tags (`<div>`, `<span>`, `<p>`, tables,
 * `<br>`, `<hr>`, headings, lists) needed for receipt layout.
 * - Inline `<style>` blocks AND `style="..."` attributes — receipt
 * templates rely heavily on inline CSS for thermal-printer fidelity.
 * - `<img>` tags with `src` allowlisted to `data:` URLs only (no
 * `http(s):` so a poisoned template cannot beacon).
 * - `class` + `id` attributes, since the renderer's CSS keys off them.
 *
 * What goes:
 * - `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link rel>`,
 * caller-provided `<meta http-equiv>`, every `on*` event handler
 * attribute. The sanitizer injects its own locked print-window CSP
 * after stripping the caller payload.
 * - Any `src`/`href` value with a non-`data:` scheme (no http, no
 * javascript:, no vbscript:).
 *
 * The whole module is a pure function so it can be unit-tested under
 * `node --test` without booting Electron.
 *
 * @module main/print-html-sanitizer
 */

import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  // Document structure — the ephemeral print window loads the body
  // verbatim, so we keep the wrapping tags it produces.
  'html',
  'head',
  'meta',
  'title',
  'body',
  'style',
  // Layout
  'div',
  'span',
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'small',
  'sup',
  'sub',
  // Lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // Tables — heavily used for receipt line breakdown.
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'col',
  'colgroup',
  // Images (constrained to data URLs only via the allowedSchemes below).
  'img',
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'id', 'style'],
  // `<meta http-equiv>` would let template authors smuggle a CSP that
  // weakens the parent window; keep `<meta charset>` only.
  meta: ['charset'],
  img: ['src', 'alt', 'width', 'height'],
  // Table layout helpers used by some templates.
  table: ['cellpadding', 'cellspacing', 'border'],
  td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'width', 'scope'],
  col: ['span', 'width'],
  colgroup: ['span'],
};

const ALLOWED_SCHEMES = ['data'];
const PRINT_WINDOW_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function printCspMetaTag(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${PRINT_WINDOW_CSP}" />`;
}

function injectPrintWindowCsp(html: string): string {
  const cspMeta = printCspMetaTag();
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${cspMeta}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b([^>]*)>/i, `<html$1><head>${cspMeta}</head>`);
  }
  return `<html><head>${cspMeta}</head><body>${html}</body></html>`;
}

/**
 * Strip every active HTML construct from the receipt payload. Idempotent
 * running this on already-sanitised HTML is a no-op. Throws never;
 * malformed input produces the empty string (caller decides what to do).
 */
export function sanitisePrintHtml(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }
  const sanitised = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // Style preserved verbatim — receipt CSS is operator-authored and
    // already constrained by the template editor's allow-list ().
    // Locking down individual declarations would force every existing
    // template through a re-validation pass; out of scope for .
    allowedStyles: {},
    // The print document intentionally keeps inline CSS for thermal
    // fidelity. We account for the risk by injecting a locked CSP below,
    // which blocks CSS `url(...)` and `@import` network fetches.
    allowVulnerableTags: true,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: {
      img: ALLOWED_SCHEMES,
    },
    exclusiveFilter(frame) {
      return frame.tag === 'meta' && !('charset' in frame.attribs);
    },
    allowProtocolRelative: false,
    // Drop the entire subtree (not just the tag) for anything outside
    // the allowlist so a `<script>alert(1)</script>` is removed
    // wholesale, not unwrapped to `alert(1)`.
    disallowedTagsMode: 'discard',
  });
  return injectPrintWindowCsp(sanitised);
}
