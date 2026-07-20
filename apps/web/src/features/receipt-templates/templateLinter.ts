/**
 * Receipt template inline linter ( pass 4 — items #2 + #7).
 *
 * Wraps a thin web-side parser around the same grammar that the
 * server's `services/template-expression.ts` validates against, then
 * exposes the result as a CodeMirror 6 `linter()` extension. The
 * editor surfaces each diagnostic as an inline red marker with a
 * tooltip on hover — exactly what item #7 asks for at edit time
 * (the server still re-validates at save time as defence in depth).
 *
 * The web parser is intentionally a bounded clone of the server
 * parser. Tree-shaking the server's pure module into the web bundle
 * would currently pull in fastify / drizzle / better-sqlite3 because
 * `@puntovivo/server` exports a single root entry point. The
 * duplication is pinned by:
 *
 * - The function-name parity tests on both sides
 * (`templateAutocomplete.test.ts` + `template-expression.test.ts`).
 * - The fixture-based parity test in `templateLinter.test.ts` that
 * runs the same "valid / unknown namespace / unknown function /
 * wrong arity / unparseable" matrix and asserts the issue counts
 * match.
 *
 * @module features/receipt-templates/templateLinter
 */

import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { TEMPLATE_FUNCTION_NAMES, TEMPLATE_NAMESPACES } from './templateAutocomplete';

// ---------------------------------------------------------------------------
// Function arity table — mirrors FUNCTION_REGISTRY on the server side.
// ---------------------------------------------------------------------------

interface ArityRange {
  min: number;
  max: number;
}

export const FUNCTION_ARITY: Record<string, ArityRange> = {
  currency: { min: 1, max: 2 },
  date: { min: 1, max: 2 },
  upper: { min: 1, max: 1 },
  lower: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  limit: { min: 2, max: 2 },
  concat: { min: 1, max: 8 },
  default: { min: 2, max: 2 },
  abs: { min: 1, max: 1 },
  max: { min: 1, max: 8 },
  min: { min: 1, max: 8 },
  sum: { min: 1, max: 8 },
};

const NAMESPACE_SET = new Set<string>(TEMPLATE_NAMESPACES);
const FUNCTION_SET = new Set<string>(TEMPLATE_FUNCTION_NAMES);

// ---------------------------------------------------------------------------
// Issue representation
// ---------------------------------------------------------------------------

export type LintIssueKind =
  | { kind: 'unparseable' }
  | { kind: 'unknownNamespace'; namespace: string }
  | { kind: 'unknownFunction'; name: string }
  | { kind: 'wrongArity'; name: string; expected: ArityRange; actual: number };

export interface LintIssue {
  /** Document-absolute start offset of the offending span. */
  from: number;
  /** Document-absolute end offset (exclusive). */
  to: number;
  detail: LintIssueKind;
}

export type LinterTranslate = (key: string, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'IDENT' | 'NUMBER' | 'STRING' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'DOT';

interface Token {
  type: TokenType;
  text: string;
  /** Document-absolute start offset. */
  from: number;
  /** Document-absolute end offset. */
  to: number;
}

const IDENT_HEAD = /[A-Za-z_]/;
const IDENT_BODY = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const WS = /\s/;

interface TokenizeResult {
  tokens: Token[];
  /** Truthy when tokenization aborted before reaching end-of-input. */
  failed: boolean;
}

function tokenizeInner(source: string, baseOffset: number): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (WS.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', text: '(', from: baseOffset + i, to: baseOffset + i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', text: ')', from: baseOffset + i, to: baseOffset + i + 1 });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', text: ',', from: baseOffset + i, to: baseOffset + i + 1 });
      i++;
      continue;
    }
    if (ch === '.') {
      tokens.push({ type: 'DOT', text: '.', from: baseOffset + i, to: baseOffset + i + 1 });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i += 2;
          continue;
        }
        i++;
      }
      if (i >= source.length) return { tokens, failed: true };
      i++;
      tokens.push({
        type: 'STRING',
        text: source.slice(start, i),
        from: baseOffset + start,
        to: baseOffset + i,
      });
      continue;
    }
    if (IDENT_HEAD.test(ch)) {
      const start = i;
      while (i < source.length && IDENT_BODY.test(source[i]!)) i++;
      tokens.push({
        type: 'IDENT',
        text: source.slice(start, i),
        from: baseOffset + start,
        to: baseOffset + i,
      });
      continue;
    }
    if (DIGIT.test(ch) || (ch === '-' && i + 1 < source.length && DIGIT.test(source[i + 1]!))) {
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
        text: source.slice(start, i),
        from: baseOffset + start,
        to: baseOffset + i,
      });
      continue;
    }
    // Unknown char.
    return { tokens, failed: true };
  }
  return { tokens, failed: false };
}

// ---------------------------------------------------------------------------
// Parser (recursive descent — collects issues per node)
// ---------------------------------------------------------------------------

/**
 * Mirrors `MAX_EXPRESSION_LENGTH` / `MAX_RECURSION_DEPTH` /
 * `MAX_FUNCTION_ARGS` in `services/template-expression.ts`. Adding a
 * length cap here keeps the editor linter bounded on the same
 * keystroke that the server validator would reject — an operator who
 * pastes a 50KB blob into a single substitution sees the same
 * "unparseable" diagnostic at edit time and at save time.
 */
const MAX_EXPRESSION_LENGTH = 200;
const MAX_RECURSION = 4;
const MAX_ARGS = 8;

interface ParseCursor {
  i: number;
}

function parseAndValidate(
  tokens: Token[],
  cursor: ParseCursor,
  depth: number,
  fullSpan: { from: number; to: number },
  issues: LintIssue[]
): boolean {
  if (depth > MAX_RECURSION) {
    issues.push({ from: fullSpan.from, to: fullSpan.to, detail: { kind: 'unparseable' } });
    return false;
  }
  const tok = tokens[cursor.i];
  if (!tok) {
    issues.push({ from: fullSpan.from, to: fullSpan.to, detail: { kind: 'unparseable' } });
    return false;
  }

  if (tok.type === 'NUMBER' || tok.type === 'STRING') {
    cursor.i++;
    return true;
  }

  if (tok.type === 'IDENT') {
    const head = tok;
    cursor.i++;
    const next = tokens[cursor.i];
    if (next && next.type === 'LPAREN') {
      // Function call
      const lparen = next;
      cursor.i++;
      let argCount = 0;
      let callEnd: number | undefined;
      if (tokens[cursor.i] && tokens[cursor.i]!.type === 'RPAREN') {
        callEnd = tokens[cursor.i]!.to;
        cursor.i++;
      } else {
        while (true) {
          const ok = parseAndValidate(tokens, cursor, depth + 1, fullSpan, issues);
          if (!ok) return false;
          argCount++;
          if (argCount > MAX_ARGS) {
            issues.push({ from: head.from, to: head.to, detail: { kind: 'unparseable' } });
            return false;
          }
          const sep = tokens[cursor.i];
          if (!sep) {
            issues.push({ from: fullSpan.from, to: fullSpan.to, detail: { kind: 'unparseable' } });
            return false;
          }
          if (sep.type === 'COMMA') {
            cursor.i++;
            continue;
          }
          if (sep.type === 'RPAREN') {
            callEnd = sep.to;
            cursor.i++;
            break;
          }
          issues.push({ from: sep.from, to: sep.to, detail: { kind: 'unparseable' } });
          return false;
        }
      }
      // Validate function name + arity
      if (!FUNCTION_SET.has(head.text)) {
        issues.push({
          from: head.from,
          to: head.to,
          detail: { kind: 'unknownFunction', name: head.text },
        });
      } else {
        const arity = FUNCTION_ARITY[head.text]!;
        if (argCount < arity.min || argCount > arity.max) {
          issues.push({
            from: lparen.from,
            to: callEnd ?? lparen.to,
            detail: { kind: 'wrongArity', name: head.text, expected: arity, actual: argCount },
          });
        }
      }
      return true;
    }
    // Path: ident ('.' ident)+
    const segments = [head];
    while (tokens[cursor.i] && tokens[cursor.i]!.type === 'DOT') {
      cursor.i++;
      const seg = tokens[cursor.i];
      if (!seg || seg.type !== 'IDENT') {
        issues.push({ from: fullSpan.from, to: fullSpan.to, detail: { kind: 'unparseable' } });
        return false;
      }
      segments.push(seg);
      cursor.i++;
    }
    if (segments.length < 2) {
      issues.push({ from: head.from, to: head.to, detail: { kind: 'unparseable' } });
      return false;
    }
    if (!NAMESPACE_SET.has(head.text)) {
      issues.push({
        from: head.from,
        to: head.to,
        detail: { kind: 'unknownNamespace', namespace: head.text },
      });
    }
    return true;
  }

  issues.push({ from: tok.from, to: tok.to, detail: { kind: 'unparseable' } });
  return false;
}

// ---------------------------------------------------------------------------
// Public lint entry point (no CM6 dependency — testable in isolation)
// ---------------------------------------------------------------------------

export function lintTemplate(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const openerIdx = text.indexOf('{{', cursor);
    if (openerIdx === -1) break;
    const closerIdx = text.indexOf('}}', openerIdx + 2);
    const innerStart = openerIdx + 2;
    const innerEnd = closerIdx === -1 ? text.length : closerIdx;
    const fullEnd = closerIdx === -1 ? text.length : closerIdx + 2;
    const innerSource = text.slice(innerStart, innerEnd);
    const fullSpan = { from: openerIdx, to: fullEnd };

    if (closerIdx === -1) {
      issues.push({ ...fullSpan, detail: { kind: 'unparseable' } });
      break;
    }

    if (innerSource.length > MAX_EXPRESSION_LENGTH) {
      issues.push({ ...fullSpan, detail: { kind: 'unparseable' } });
      cursor = fullEnd;
      continue;
    }

    const tokenResult = tokenizeInner(innerSource, innerStart);
    if (tokenResult.failed) {
      issues.push({ ...fullSpan, detail: { kind: 'unparseable' } });
    } else if (tokenResult.tokens.length === 0) {
      issues.push({ ...fullSpan, detail: { kind: 'unparseable' } });
    } else {
      const parseCursor: ParseCursor = { i: 0 };
      const ok = parseAndValidate(tokenResult.tokens, parseCursor, 0, fullSpan, issues);
      if (ok && parseCursor.i !== tokenResult.tokens.length) {
        const trailing = tokenResult.tokens[parseCursor.i]!;
        issues.push({
          from: trailing.from,
          to: trailing.to,
          detail: { kind: 'unparseable' },
        });
      }
    }

    cursor = fullEnd;
  }
  return issues;
}

// ---------------------------------------------------------------------------
// CodeMirror 6 linter extension
// ---------------------------------------------------------------------------

function describeIssue(detail: LintIssueKind, t: LinterTranslate): string {
  switch (detail.kind) {
    case 'unparseable':
      return t('editor.codeEditor.linter.unparseable');
    case 'unknownNamespace':
      return t('editor.codeEditor.linter.unknownNamespace', {
        namespace: detail.namespace,
        allowed: TEMPLATE_NAMESPACES.join(', '),
      });
    case 'unknownFunction':
      return t('editor.codeEditor.linter.unknownFunction', {
        name: detail.name,
        allowed: TEMPLATE_FUNCTION_NAMES.slice().sort().join(', '),
      });
    case 'wrongArity': {
      const expected =
        detail.expected.min === detail.expected.max
          ? `${detail.expected.min}`
          : `${detail.expected.min}-${detail.expected.max}`;
      return t('editor.codeEditor.linter.wrongArity', {
        name: detail.name,
        expected,
        actual: detail.actual,
      });
    }
  }
}

export function buildTemplateLinter(t: LinterTranslate): Extension {
  return linter(view => {
    const text = view.state.doc.toString();
    const issues = lintTemplate(text);
    return issues.map<Diagnostic>(issue => ({
      from: issue.from,
      to: issue.to,
      severity: 'error',
      message: describeIssue(issue.detail, t),
    }));
  });
}
