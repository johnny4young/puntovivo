/**
 * Receipt template expression engine — evaluate back-end (,  split).
 *
 * Coercion helpers (incl. the MAX_DECIMALS clamp), the date-pattern formatter,
 * the whitelisted FUNCTION_REGISTRY, the evaluator (catch-all + arity guard),
 * and the validator (the rejectStringScheme + namespace-whitelist security
 * guards). Imports the AST + parseTemplate from `./parse.js`.
 *
 * @module services/template-expression/evaluate
 */
import { parseTemplate, MAX_FUNCTION_ARGS, MAX_DECIMALS } from './parse.js';
import type { ExpressionNode } from './parse.js';

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvalContext {
  /** Resolves a dotted path against the render data. */
  lookupPath: (path: string) => unknown;
  /** Locale-aware currency formatter. Falls back to `value.toFixed(decimals ?? 2)`. */
  formatCurrency?: (value: number, decimals?: number) => string;
  /** Locale-aware date formatter. Falls back to the built-in pattern engine. */
  formatDate?: (value: unknown, pattern: string | undefined) => string;
}

interface FunctionSpec {
  minArgs: number;
  maxArgs: number;
  evaluate: (args: unknown[], ctx: EvalContext) => unknown;
}

function toScalarString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function toNumberValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

const DATE_PATTERN_TOKEN = /yyyy|MM|dd|HH|mm|ss/g;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export function applyDatePattern(date: Date, pattern: string): string {
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1, 2),
    dd: pad(date.getDate(), 2),
    HH: pad(date.getHours(), 2),
    mm: pad(date.getMinutes(), 2),
    ss: pad(date.getSeconds(), 2),
  };
  return pattern.replace(DATE_PATTERN_TOKEN, match => tokens[match] ?? match);
}

const DEFAULT_DATE_PATTERN = 'yyyy-MM-dd';

function clampDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > MAX_DECIMALS) return MAX_DECIMALS;
  return Math.floor(value);
}

export const FUNCTION_REGISTRY: Record<string, FunctionSpec> = {
  currency: {
    minArgs: 1,
    maxArgs: 2,
    evaluate: (args, ctx) => {
      const value = toNumberValue(args[0]);
      const decimals = args[1] !== undefined ? clampDecimals(toNumberValue(args[1])) : undefined;
      if (ctx.formatCurrency) return ctx.formatCurrency(value, decimals);
      return value.toFixed(decimals ?? 2);
    },
  },
  date: {
    minArgs: 1,
    maxArgs: 2,
    evaluate: (args, ctx) => {
      const value = args[0];
      const pattern = args[1] !== undefined ? toScalarString(args[1]) : undefined;
      if (ctx.formatDate) return ctx.formatDate(value, pattern);
      const d = coerceDate(value);
      if (!d) return '';
      return applyDatePattern(d, pattern ?? DEFAULT_DATE_PATTERN);
    },
  },
  upper: {
    minArgs: 1,
    maxArgs: 1,
    evaluate: args => toScalarString(args[0]).toUpperCase(),
  },
  lower: {
    minArgs: 1,
    maxArgs: 1,
    evaluate: args => toScalarString(args[0]).toLowerCase(),
  },
  round: {
    minArgs: 1,
    maxArgs: 2,
    evaluate: args => {
      const value = toNumberValue(args[0]);
      const decimals = args[1] !== undefined ? clampDecimals(toNumberValue(args[1])) : 0;
      const factor = Math.pow(10, decimals);
      return Math.round(value * factor) / factor;
    },
  },
  limit: {
    minArgs: 2,
    maxArgs: 2,
    evaluate: args => {
      const chars = Array.from(toScalarString(args[0]));
      const max = Math.max(0, Math.floor(toNumberValue(args[1])));
      if (chars.length <= max) return chars.join('');
      if (max <= 3) return chars.slice(0, max).join('');
      return chars.slice(0, max - 3).join('') + '...';
    },
  },
  concat: {
    minArgs: 1,
    maxArgs: MAX_FUNCTION_ARGS,
    evaluate: args => args.map(toScalarString).join(''),
  },
  default: {
    minArgs: 2,
    maxArgs: 2,
    evaluate: args => (isEmptyValue(args[0]) ? args[1] : args[0]),
  },
  abs: {
    minArgs: 1,
    maxArgs: 1,
    evaluate: args => Math.abs(toNumberValue(args[0])),
  },
  max: {
    minArgs: 1,
    maxArgs: MAX_FUNCTION_ARGS,
    evaluate: args => Math.max(...args.map(toNumberValue)),
  },
  min: {
    minArgs: 1,
    maxArgs: MAX_FUNCTION_ARGS,
    evaluate: args => Math.min(...args.map(toNumberValue)),
  },
  sum: {
    minArgs: 1,
    maxArgs: MAX_FUNCTION_ARGS,
    evaluate: args => args.map(toNumberValue).reduce((acc, n) => acc + n, 0),
  },
};

export function evaluateExpression(node: ExpressionNode, ctx: EvalContext): unknown {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'string':
      return node.value;
    case 'path':
      return ctx.lookupPath(node.segments.join('.'));
    case 'funcCall': {
      const spec = FUNCTION_REGISTRY[node.name];
      if (!spec) return '';
      // Runtime arity guard — `validateTemplate` already catches arity
      // mismatches at save time, but `evaluateTemplate` is exported as a
      // public API and can be called against an AST that has not been
      // validated (e.g. a future caller that bypasses Zod). Returning
      // empty here keeps the renderer side-effect-free under malformed
      // input rather than producing NaN / undefined surprises like
      // `Math.max(...[])` → `-Infinity` or `default([only-one-arg])`
      // reading `args[1] === undefined`.
      if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        return '';
      }
      const args = node.args.map(arg => evaluateExpression(arg, ctx));
      return spec.evaluate(args, ctx);
    }
  }
}

export function evaluateTemplate(template: string, ctx: EvalContext): string {
  const result = parseTemplate(template);
  const out: string[] = [];
  for (const node of result.nodes) {
    if (node.type === 'literal') {
      out.push(node.value);
      continue;
    }
    try {
      out.push(toScalarString(evaluateExpression(node.expression, ctx)));
    } catch {
      out.push('');
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Validation (used by Zod refinements at save time)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  message: string;
  raw: string;
}

// explicit `| undefined` on each optional field.
export interface ValidateOptions {
  allowedNamespaces?: ReadonlySet<string> | undefined;
  /** Restrict which namespaces are allowed (e.g. `qr.source` may exclude `tender`). */
  rejectedNamespaces?: ReadonlySet<string> | undefined;
  /** When set, string literal nodes whose trimmed value matches this regex raise an issue. */
  rejectStringScheme?: RegExp | undefined;
}

function walkExpression(
  node: ExpressionNode,
  raw: string,
  issues: ValidationIssue[],
  options: ValidateOptions
): void {
  switch (node.type) {
    case 'number':
      return;
    case 'string': {
      if (options.rejectStringScheme && options.rejectStringScheme.test(node.value.trim())) {
        issues.push({
          message: `String literal "${node.value}" uses a disallowed URL scheme. javascript:, data:, vbscript: and file: are not permitted.`,
          raw,
        });
      }
      return;
    }
    case 'path': {
      const ns = node.segments[0];
      if (!ns) {
        issues.push({
          message: 'Variable path is empty',
          raw,
        });
        return;
      }
      if (options.allowedNamespaces && !options.allowedNamespaces.has(ns)) {
        const allowed = [...options.allowedNamespaces].join(', ');
        issues.push({
          message: `Variable {{${node.segments.join('.')}}} references unknown namespace "${ns}". Allowed: ${allowed}`,
          raw,
        });
      }
      if (options.rejectedNamespaces && options.rejectedNamespaces.has(ns)) {
        issues.push({
          message: `Variable {{${node.segments.join('.')}}} cannot use namespace "${ns}" in this field`,
          raw,
        });
      }
      return;
    }
    case 'funcCall': {
      const spec = FUNCTION_REGISTRY[node.name];
      if (!spec) {
        const available = Object.keys(FUNCTION_REGISTRY).sort().join(', ');
        issues.push({
          message: `Unknown function "${node.name}". Available: ${available}`,
          raw,
        });
        return;
      }
      if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
        const arity =
          spec.minArgs === spec.maxArgs ? `${spec.minArgs}` : `${spec.minArgs}-${spec.maxArgs}`;
        issues.push({
          message: `Function "${node.name}" takes ${arity} argument(s), got ${node.args.length}`,
          raw,
        });
      }
      for (const arg of node.args) walkExpression(arg, raw, issues, options);
      return;
    }
  }
}

export function validateTemplate(
  template: string,
  options: ValidateOptions = {}
): ValidationIssue[] {
  const result = parseTemplate(template);
  const issues: ValidationIssue[] = result.errors.map(err => ({
    message: err.message,
    raw: err.raw,
  }));
  for (const node of result.nodes) {
    if (node.type === 'substitution') {
      walkExpression(node.expression, node.raw, issues, options);
    }
  }
  return issues;
}
