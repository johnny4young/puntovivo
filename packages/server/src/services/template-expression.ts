/**
 * Receipt template expression engine (ENG-016 pass 3 — item #3).
 *
 * Extends the legacy regex-based `{{namespace.path}}` substitution with a
 * small, whitelisted expression grammar that supports formatter and
 * aggregation functions on top of the existing variable references.
 *
 * Grammar (recursive descent, no precedence):
 *
 *   substitution = '{{' expression '}}'
 *   expression   = funcCall | path | numberLiteral | stringLiteral
 *   funcCall     = identifier '(' (expression (',' expression)*)? ')'
 *   path         = identifier ('.' identifier)+   // namespace.field, ≥1 dot
 *   identifier   = [a-zA-Z_][a-zA-Z0-9_]*
 *   numberLiteral = -? digits ('.' digits)?
 *   stringLiteral = '"' chars '"' | "'" chars "'"
 *
 * Function calls are restricted to a static whitelist (FUNCTION_REGISTRY)
 * with explicit arity bounds — the validator rejects unknown names or
 * wrong argument counts at Zod refinement time. This is the only path
 * that can produce side-effect-free formatting; there is no general
 * expression evaluator and no access to host globals.
 *
 * Evaluation runs against a caller-supplied `EvalContext` that provides
 * the path resolver and (optionally) locale-aware currency / date
 * formatters. The renderer wires these to `lookupPath` and
 * `formatReceiptAmount` so the new helpers inherit ENG-017's
 * tenant-locale behaviour without duplicating the `Intl.NumberFormat`
 * config.
 *
 * Security:
 *  - String literal nodes are checked against `rejectStringScheme` at
 *    validation time so `concat("javascript:", …)` cannot bypass the
 *    `qr.source` URL-scheme guard already on `receiptTemplates.ts`.
 *  - The renderer's existing `safeResolvedScannerSource()` keeps the
 *    post-resolution scheme check as defense-in-depth.
 *  - Output of `evaluateTemplate` is plain text; HTML escaping is the
 *    caller's responsibility (renderer wraps it in `escapeHtml`).
 *
 * @module services/template-expression
 */

// ---------------------------------------------------------------------------
// Limits — keep parsing bounded so a hostile or accidentally pathological
// template cannot block save/render.
// ---------------------------------------------------------------------------

export const MAX_EXPRESSION_LENGTH = 200;
export const MAX_FUNCTION_ARGS = 8;
export const MAX_RECURSION_DEPTH = 4;
/**
 * Decimal-count cap for `currency()` and `round()`. `Math.pow(10, 1000)`
 * is `Infinity`, and `value * Infinity / Infinity = NaN`, which would
 * silently render as the empty string and lose the operator's amount
 * mid-receipt. 20 is also the JavaScript spec ceiling for
 * `Number.prototype.toFixed`.
 */
export const MAX_DECIMALS = 20;

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export interface PathNode {
  type: 'path';
  segments: string[];
}

export interface FuncCallNode {
  type: 'funcCall';
  name: string;
  args: ExpressionNode[];
}

export interface NumberLiteralNode {
  type: 'number';
  value: number;
}

export interface StringLiteralNode {
  type: 'string';
  value: string;
}

export type ExpressionNode =
  | PathNode
  | FuncCallNode
  | NumberLiteralNode
  | StringLiteralNode;

export interface LiteralChunkNode {
  type: 'literal';
  value: string;
}

export interface SubstitutionNode {
  type: 'substitution';
  expression: ExpressionNode;
  raw: string;
}

export type TemplateNode = LiteralChunkNode | SubstitutionNode;

export interface ParseError {
  message: string;
  raw: string;
}

export interface ParseResult {
  nodes: TemplateNode[];
  errors: ParseError[];
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType =
  | 'IDENT'
  | 'NUMBER'
  | 'STRING'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'DOT';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

interface TokenizeResult {
  tokens: Token[];
  error: string | null;
}

const IDENT_HEAD = /[a-zA-Z_]/;
const IDENT_BODY = /[a-zA-Z0-9_]/;
const DIGIT = /[0-9]/;
const WS = /\s/;

function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (WS.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', pos: i });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'DOT', value: '.', pos: i });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let str = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1]!;
          switch (next) {
            case 'n':
              str += '\n';
              break;
            case 't':
              str += '\t';
              break;
            case 'r':
              str += '\r';
              break;
            case '\\':
              str += '\\';
              break;
            default:
              str += next;
              break;
          }
          i += 2;
        } else {
          str += source[i]!;
          i++;
        }
      }
      if (i >= source.length) {
        return {
          tokens,
          error: `Unterminated string literal starting at position ${start}`,
        };
      }
      i++;
      tokens.push({ type: 'STRING', value: str, pos: start });
      continue;
    }
    if (IDENT_HEAD.test(ch)) {
      const start = i;
      while (i < source.length && IDENT_BODY.test(source[i]!)) i++;
      tokens.push({
        type: 'IDENT',
        value: source.slice(start, i),
        pos: start,
      });
      continue;
    }
    if (
      DIGIT.test(ch) ||
      (ch === '-' && i + 1 < source.length && DIGIT.test(source[i + 1]!))
    ) {
      const start = i;
      if (ch === '-') i++;
      while (i < source.length && DIGIT.test(source[i]!)) i++;
      if (
        i < source.length &&
        source[i] === '.' &&
        i + 1 < source.length &&
        DIGIT.test(source[i + 1]!)
      ) {
        i++;
        while (i < source.length && DIGIT.test(source[i]!)) i++;
      }
      tokens.push({
        type: 'NUMBER',
        value: source.slice(start, i),
        pos: start,
      });
      continue;
    }
    return {
      tokens,
      error: `Unexpected character ${JSON.stringify(ch)} at position ${i}`,
    };
  }
  return { tokens, error: null };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParseCursor {
  i: number;
}

interface ParseExprResult {
  node: ExpressionNode | null;
  error: string | null;
}

function parseExpression(
  tokens: Token[],
  cursor: ParseCursor,
  depth: number
): ParseExprResult {
  if (depth > MAX_RECURSION_DEPTH) {
    return {
      node: null,
      error: `Expression nested deeper than ${MAX_RECURSION_DEPTH} levels`,
    };
  }
  const tok = tokens[cursor.i];
  if (!tok) {
    return { node: null, error: 'Expression expected' };
  }

  if (tok.type === 'NUMBER') {
    cursor.i++;
    const parsed = Number.parseFloat(tok.value);
    if (!Number.isFinite(parsed)) {
      return { node: null, error: `Invalid number literal "${tok.value}"` };
    }
    return { node: { type: 'number', value: parsed }, error: null };
  }

  if (tok.type === 'STRING') {
    cursor.i++;
    return { node: { type: 'string', value: tok.value }, error: null };
  }

  if (tok.type === 'IDENT') {
    const head = tok.value;
    cursor.i++;
    const next = tokens[cursor.i];
    if (next && next.type === 'LPAREN') {
      cursor.i++;
      const args: ExpressionNode[] = [];
      if (tokens[cursor.i] && tokens[cursor.i]!.type === 'RPAREN') {
        cursor.i++;
        return { node: { type: 'funcCall', name: head, args }, error: null };
      }
      while (true) {
        const argRes = parseExpression(tokens, cursor, depth + 1);
        if (argRes.error || !argRes.node) {
          return {
            node: null,
            error: argRes.error ?? 'Argument expected',
          };
        }
        args.push(argRes.node);
        if (args.length > MAX_FUNCTION_ARGS) {
          return {
            node: null,
            error: `Function "${head}" exceeds ${MAX_FUNCTION_ARGS} arguments`,
          };
        }
        const sep = tokens[cursor.i];
        if (!sep) {
          return { node: null, error: `Unclosed call to "${head}"` };
        }
        if (sep.type === 'COMMA') {
          cursor.i++;
          continue;
        }
        if (sep.type === 'RPAREN') {
          cursor.i++;
          break;
        }
        return {
          node: null,
          error: `Expected , or ) inside call to "${head}", got "${sep.value}"`,
        };
      }
      return { node: { type: 'funcCall', name: head, args }, error: null };
    }
    const segments = [head];
    while (tokens[cursor.i] && tokens[cursor.i]!.type === 'DOT') {
      cursor.i++;
      const seg = tokens[cursor.i];
      if (!seg || seg.type !== 'IDENT') {
        return {
          node: null,
          error: 'Expected identifier after "." in variable path',
        };
      }
      segments.push(seg.value);
      cursor.i++;
    }
    if (segments.length < 2) {
      return {
        node: null,
        error: `Variable path "${head}" must have at least one dot (e.g. namespace.field)`,
      };
    }
    return { node: { type: 'path', segments }, error: null };
  }

  return { node: null, error: `Unexpected token "${tok.value}"` };
}

// ---------------------------------------------------------------------------
// Public parser
// ---------------------------------------------------------------------------

export function parseTemplate(template: string): ParseResult {
  const nodes: TemplateNode[] = [];
  const errors: ParseError[] = [];
  let cursor = 0;

  while (cursor < template.length) {
    const start = template.indexOf('{{', cursor);
    if (start === -1) {
      const tail = template.slice(cursor);
      if (tail.length > 0) nodes.push({ type: 'literal', value: tail });
      break;
    }
    if (start > cursor) {
      nodes.push({ type: 'literal', value: template.slice(cursor, start) });
    }
    const end = template.indexOf('}}', start + 2);
    if (end === -1) {
      const raw = template.slice(start);
      errors.push({ message: 'Unterminated `{{` substitution', raw });
      nodes.push({ type: 'literal', value: raw });
      break;
    }
    const inner = template.slice(start + 2, end);
    const raw = template.slice(start, end + 2);

    if (inner.length > MAX_EXPRESSION_LENGTH) {
      errors.push({
        message: `Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`,
        raw,
      });
      nodes.push({ type: 'literal', value: raw });
      cursor = end + 2;
      continue;
    }

    const tokenResult = tokenize(inner);
    if (tokenResult.error) {
      errors.push({ message: tokenResult.error, raw });
      nodes.push({ type: 'literal', value: raw });
      cursor = end + 2;
      continue;
    }
    if (tokenResult.tokens.length === 0) {
      errors.push({ message: 'Empty `{{...}}` substitution', raw });
      nodes.push({ type: 'literal', value: raw });
      cursor = end + 2;
      continue;
    }

    const parseCursor: ParseCursor = { i: 0 };
    const exprResult = parseExpression(tokenResult.tokens, parseCursor, 0);
    if (exprResult.error || !exprResult.node) {
      errors.push({
        message: exprResult.error ?? 'Failed to parse expression',
        raw,
      });
      nodes.push({ type: 'literal', value: raw });
      cursor = end + 2;
      continue;
    }
    if (parseCursor.i !== tokenResult.tokens.length) {
      const trailing = tokenResult.tokens[parseCursor.i]!;
      errors.push({
        message: `Unexpected trailing token "${trailing.value}"`,
        raw,
      });
      nodes.push({ type: 'literal', value: raw });
      cursor = end + 2;
      continue;
    }

    nodes.push({ type: 'substitution', expression: exprResult.node, raw });
    cursor = end + 2;
  }

  return { nodes, errors };
}

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
  if (typeof value === 'number')
    return Number.isFinite(value) ? value.toString() : '';
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
      const decimals =
        args[1] !== undefined
          ? clampDecimals(toNumberValue(args[1]))
          : undefined;
      if (ctx.formatCurrency) return ctx.formatCurrency(value, decimals);
      return value.toFixed(decimals ?? 2);
    },
  },
  date: {
    minArgs: 1,
    maxArgs: 2,
    evaluate: (args, ctx) => {
      const value = args[0];
      const pattern =
        args[1] !== undefined ? toScalarString(args[1]) : undefined;
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
      const decimals =
        args[1] !== undefined ? clampDecimals(toNumberValue(args[1])) : 0;
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
    evaluate: args =>
      args.map(toNumberValue).reduce((acc, n) => acc + n, 0),
  },
};

export function evaluateExpression(
  node: ExpressionNode,
  ctx: EvalContext
): unknown {
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
      if (
        node.args.length < spec.minArgs ||
        node.args.length > spec.maxArgs
      ) {
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

export interface ValidateOptions {
  allowedNamespaces?: ReadonlySet<string>;
  /** Restrict which namespaces are allowed (e.g. `qr.source` may exclude `tender`). */
  rejectedNamespaces?: ReadonlySet<string>;
  /** When set, string literal nodes whose trimmed value matches this regex raise an issue. */
  rejectStringScheme?: RegExp;
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
      if (
        options.rejectStringScheme &&
        options.rejectStringScheme.test(node.value.trim())
      ) {
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
      if (
        node.args.length < spec.minArgs ||
        node.args.length > spec.maxArgs
      ) {
        const arity =
          spec.minArgs === spec.maxArgs
            ? `${spec.minArgs}`
            : `${spec.minArgs}-${spec.maxArgs}`;
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

// ---------------------------------------------------------------------------
// Helpers re-exported for callers that build their own rendering
// pipelines (kept minimal — most callers just use evaluateTemplate).
// ---------------------------------------------------------------------------

export const __test = {
  tokenize,
  parseExpression,
  toScalarString,
  toNumberValue,
  coerceDate,
};
