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

// ENG-178 — decomposed into `./template-expression/` (parse front-end +
// evaluate back-end). This file stays at the original path as a thin re-export
// barrel so the 4 importers (receiptTemplates schema, escape-resolve,
// format-helpers, test) resolve unchanged.

export {
  MAX_EXPRESSION_LENGTH,
  MAX_FUNCTION_ARGS,
  MAX_RECURSION_DEPTH,
  MAX_DECIMALS,
  parseTemplate,
} from './template-expression/parse.js';
export type {
  PathNode,
  FuncCallNode,
  NumberLiteralNode,
  StringLiteralNode,
  ExpressionNode,
  LiteralChunkNode,
  SubstitutionNode,
  TemplateNode,
  ParseError,
  ParseResult,
} from './template-expression/parse.js';
export {
  applyDatePattern,
  FUNCTION_REGISTRY,
  evaluateExpression,
  evaluateTemplate,
  validateTemplate,
} from './template-expression/evaluate.js';
export type {
  EvalContext,
  ValidationIssue,
  ValidateOptions,
} from './template-expression/evaluate.js';
