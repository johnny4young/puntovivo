/**
 * Receipt template expression engine — parse front-end (ENG-016, ENG-178 split).
 *
 * Bounds + AST node types, the tokenizer, the recursive-descent parser, and the
 * `parseTemplate` entry. Enforces the expression-length, function-arg-count, and
 * recursion-depth limits. Self-contained leaf (no back-end deps).
 *
 * @module services/template-expression/parse
 */
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
