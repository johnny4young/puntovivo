/**
 * Receipt template StreamLanguage (ENG-016 pass 4 — CodeMirror 6).
 *
 * Tokenizes the moustache-style grammar that the renderer accepts:
 *
 *   text                             — anything outside `{{ ... }}`
 *   {{ namespace.path }}             — bare-path substitution
 *   {{ fn(arg, arg, …) }}            — whitelisted formatter call
 *   {{ fn(literal, "string", 1.5) }} — literals as args
 *   {{ fn(other(arg)) }}             — one level of nested call
 *
 * Token classes line up with `@lezer/highlight` standard tags so any
 * default CodeMirror theme (one-dark, one-light, etc.) renders the
 * tokens in distinct colors. The tags chosen:
 *
 *   bracket          — the `{{` and `}}` delimiters
 *   variableName     — namespace + property identifiers
 *   function(varName)— function-call names
 *   string           — quoted literal arguments
 *   number           — numeric literal arguments
 *   punctuation      — `.` `,` `(` `)`
 *
 * The grammar is shallow enough that StreamLanguage's per-line token
 * stream is sufficient — there is no need for the full Lezer parser
 * (which would require a build-time grammar compilation step).
 *
 * @module features/receipt-templates/templateLanguage
 */

import {
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { Extension } from '@codemirror/state';

interface State {
  /** Are we currently between `{{` and `}}`? */
  inSubstitution: boolean;
  /** Did the previous token open a function call? Used to color the next ident as a function name. */
  expectIdentAfterDot: boolean;
  /** Did we just emit an identifier? Used to color a follow-up `(` as call-bracket. */
  identCanBecomeCall: boolean;
}

function startState(): State {
  return {
    inSubstitution: false,
    expectIdentAfterDot: false,
    identCanBecomeCall: false,
  };
}

const IDENT_HEAD = /[A-Za-z_]/;
const IDENT_BODY = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

const streamParser: StreamParser<State> = {
  name: 'receipt-template',
  startState,
  copyState: state => ({ ...state }),
  token(stream, state) {
    if (!state.inSubstitution) {
      // Outside `{{ … }}`: scan until we hit `{{` or end-of-line.
      if (stream.match('{{')) {
        state.inSubstitution = true;
        state.expectIdentAfterDot = false;
        state.identCanBecomeCall = false;
        return 'bracket';
      }
      // Consume one character that is not the start of `{{`.
      const next = stream.next();
      if (next === undefined) return null;
      if (next === '{' && stream.peek() === '{') {
        // Backtrack so the match above fires on the next call.
        stream.backUp(1);
        return null;
      }
      // Eat the rest of plain text up to the next `{` or EOL.
      while (!stream.eol()) {
        const peek = stream.peek();
        if (peek === '{') break;
        stream.next();
      }
      return null;
    }

    // Inside `{{ … }}`.
    if (stream.eatSpace()) return null;

    if (stream.match('}}')) {
      state.inSubstitution = false;
      state.expectIdentAfterDot = false;
      state.identCanBecomeCall = false;
      return 'bracket';
    }

    const ch = stream.peek();
    if (ch === undefined) return null;

    if (ch === '"' || ch === "'") {
      const quote = ch;
      stream.next();
      while (!stream.eol()) {
        const next = stream.next();
        if (next === '\\' && !stream.eol()) {
          stream.next();
          continue;
        }
        if (next === quote) break;
      }
      state.identCanBecomeCall = false;
      state.expectIdentAfterDot = false;
      return 'string';
    }

    if (
      DIGIT.test(ch) ||
      (ch === '-' && stream.string[stream.pos + 1] !== undefined && DIGIT.test(stream.string[stream.pos + 1]!))
    ) {
      stream.next();
      while (!stream.eol() && DIGIT.test(stream.peek() ?? '')) stream.next();
      if (stream.peek() === '.' && DIGIT.test(stream.string[stream.pos + 1] ?? '')) {
        stream.next();
        while (!stream.eol() && DIGIT.test(stream.peek() ?? '')) stream.next();
      }
      state.identCanBecomeCall = false;
      state.expectIdentAfterDot = false;
      return 'number';
    }

    if (IDENT_HEAD.test(ch)) {
      stream.next();
      while (!stream.eol() && IDENT_BODY.test(stream.peek() ?? '')) stream.next();
      const isFunctionName = stream.peek() === '(';
      state.identCanBecomeCall = isFunctionName;
      state.expectIdentAfterDot = false;
      return isFunctionName ? 'function' : 'variableName';
    }

    if (ch === '.') {
      stream.next();
      state.expectIdentAfterDot = true;
      state.identCanBecomeCall = false;
      return 'punctuation';
    }

    if (ch === '(' || ch === ')') {
      stream.next();
      state.identCanBecomeCall = false;
      state.expectIdentAfterDot = false;
      return 'bracket';
    }

    if (ch === ',') {
      stream.next();
      state.identCanBecomeCall = false;
      state.expectIdentAfterDot = false;
      return 'punctuation';
    }

    // Anything else is a stray character — emit it as `invalid` so
    // the linter has something to hang an error on, then advance.
    stream.next();
    return 'invalid';
  },
};

export const receiptTemplateLanguage = StreamLanguage.define<State>(streamParser);

/**
 * Highlight palette tuned for the surrounding light surface in the
 * receipt template editor. Colors are kept conservative so the editor
 * doesn't fight the rest of the admin UI.
 */
export const receiptTemplateHighlightStyle = HighlightStyle.define([
  { tag: t.bracket, color: '#7c3aed', fontWeight: '600' },
  { tag: t.variableName, color: '#0f766e' },
  { tag: t.function(t.variableName), color: '#1d4ed8', fontWeight: '500' },
  { tag: t.string, color: '#b45309' },
  { tag: t.number, color: '#9333ea' },
  { tag: t.punctuation, color: '#475569' },
  { tag: t.invalid, color: '#dc2626', textDecoration: 'underline wavy' },
]);

/**
 * Bundled extension that wires the language + highlight style — the
 * editor adds this directly via `extensions={[receiptTemplateExtension(), …]}`.
 */
export function receiptTemplateExtension(): Extension {
  return [receiptTemplateLanguage, syntaxHighlighting(receiptTemplateHighlightStyle)];
}

/**
 * Internal accessor for tests — exposes the raw `StreamParser` so the
 * test driver can step the tokenizer one token at a time without going
 * through the syntax-tree compression that StreamLanguage applies for
 * highlighting purposes.
 */
export const __test = {
  streamParser,
};
