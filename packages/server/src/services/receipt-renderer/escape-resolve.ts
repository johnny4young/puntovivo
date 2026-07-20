/**
 * Receipt renderer HTML-escape + template-substitution helpers.
 *
 * extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. Security-critical: `escapeHtml` +
 * `resolveAndEscape` are the defense-in-depth escaping layer ( pass 3)
 * and `lookupPath` carries the prototype-pollution guard. Bodies moved
 * byte-for-byte; `resolvePlain` gained `export` for the scanner-url + ESC/POS
 * modules.
 *
 * @module services/receipt-renderer/escape-resolve
 */
import { evaluateTemplate, type EvalContext } from '../template-expression.js';

import type { RenderData } from './types.js';
import { formatReceiptAmount, formatTemplateDate } from './format-helpers.js';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] ?? char);
}

/**
 * Resolve a dotted path inside the render-data record. Returns
 * undefined if any segment is missing — the renderer treats that as
 * the empty string to keep partially-configured layouts robust (a
 * freshly-installed tenant may not have set `fiscal.cufe` yet, and the
 * receipt should still print cleanly).
 *
 * Uses `Object.prototype.hasOwnProperty.call` (not `in`) so prototype
 * chain segments like `__proto__`, `constructor`, or `toString` cannot
 * leak through the namespace whitelist. The Zod validator restricts
 * top-level namespaces but does not constrain nested paths — this
 * guard is the runtime defense.
 */
function lookupPath(data: RenderData, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = data as unknown as Record<string, unknown>;
  for (const segment of segments) {
    if (
      current &&
      typeof current === 'object' &&
      Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Build the EvalContext consumed by the template-expression engine.
 * Exposes the path resolver plus tenant-locale-aware currency/date
 * formatters so the `{{ currency(...) }}` and `{{ date(...) }}` helpers
 * inherit  behaviour without duplicating the Intl config.
 */
function buildEvalContext(data: RenderData): EvalContext {
  return {
    lookupPath: path => lookupPath(data, path),
    formatCurrency: (value, decimals) => formatReceiptAmount(value, data.locale, decimals),
    formatDate: (value, pattern) => {
      const explicit = pattern && pattern.length > 0 ? pattern : undefined;
      const fallback = data.locale?.dateFormat;
      return formatTemplateDate(value, explicit ?? fallback);
    },
  };
}

/**
 * pass 3 — Resolve `{{variable}}` and `{{ fn(...) }}`
 * substitutions and return the result already HTML-escaped. The
 * function NEVER concatenates raw user input into the returned HTML:
 * the entire substituted string passes through `escapeHtml` at the
 * exit, so neither literal markup typed in `text.value` nor data
 * pulled in via a path or function call can survive as live HTML.
 */
export function resolveAndEscape(template: string, data: RenderData): string {
  return escapeHtml(evaluateTemplate(template, buildEvalContext(data)));
}

/**
 * Plain-text variant for ESC/POS output. Same expression engine,
 * without HTML escaping (the printer renders raw bytes; HTML entities
 * would print literally). Variables and functions still resolve
 * through the same whitelist that Zod enforced upstream.
 */
export function resolvePlain(template: string, data: RenderData): string {
  return evaluateTemplate(template, buildEvalContext(data));
}
