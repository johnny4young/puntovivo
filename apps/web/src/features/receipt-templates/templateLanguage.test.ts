import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { StringStream } from '@codemirror/language';
import {
  receiptTemplateExtension,
  __test as templateLanguageTest,
} from './templateLanguage';

interface TokenSpan {
  type: string;
  text: string;
  from: number;
  to: number;
}

function tokenize(source: string): TokenSpan[] {
  // Drive the StreamParser manually so adjacent same-class tokens stay
  // separate (the syntax tree built by StreamLanguage compresses
  // consecutive same-style spans into a single node, which loses the
  // `{{` / `}}` boundary we want to assert on).
  const parser = templateLanguageTest.streamParser;
  const state = parser.startState!(2);
  const tokens: TokenSpan[] = [];
  const lines = source.split('\n');
  let lineStart = 0;
  for (const line of lines) {
    const stream = new StringStream(line, 2, 2, 0);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const type = parser.token(stream, state);
      if (stream.pos === stream.start) {
        // Defensive: parser must always advance.
        stream.pos = stream.start + 1;
      }
      const text = line.slice(stream.start, stream.pos);
      if (text.length === 0) continue;
      tokens.push({
        type: type ?? '',
        text,
        from: lineStart + stream.start,
        to: lineStart + stream.pos,
      });
    }
    lineStart += line.length + 1;
  }
  return tokens;
}

function tokenTypes(source: string): string[] {
  return tokenize(source).map(t => t.type).filter(t => t.length > 0);
}

describe('receiptTemplateLanguage — tokenizer', () => {
  it('emits only null-typed (text) tokens for plain text outside substitutions', () => {
    const tokens = tokenize('Hello world');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every(t => t.type === '' || t.type === null)).toBe(true);
  });

  it('tags both braces of a bare-path substitution as bracket', () => {
    const tokens = tokenize('{{sale.grandTotal}}');
    const brackets = tokens.filter(t => t.type === 'bracket');
    expect(brackets.map(t => t.text)).toEqual(['{{', '}}']);
  });

  it('tags namespace and property identifiers as variableName', () => {
    const tokens = tokenize('{{sale.grandTotal}}');
    const idents = tokens.filter(t => t.type === 'variableName');
    expect(idents.map(t => t.text)).toEqual(['sale', 'grandTotal']);
  });

  it('tags an identifier followed by `(` as function', () => {
    const tokens = tokenize('{{currency(sale.grandTotal)}}');
    const fns = tokens.filter(t => t.type === 'function');
    expect(fns.map(t => t.text)).toEqual(['currency']);
  });

  it('tags string literal arguments as string (single + double quoted)', () => {
    const tokens = tokenize(`{{ concat("a", 'b') }}`);
    const strings = tokens.filter(t => t.type === 'string');
    expect(strings.map(t => t.text)).toEqual(['"a"', "'b'"]);
  });

  it('tags numeric literal arguments as number (with negative + decimal)', () => {
    const tokens = tokenize('{{ max(-1, 2.5, 3) }}');
    const numbers = tokens.filter(t => t.type === 'number');
    expect(numbers.map(t => t.text)).toEqual(['-1', '2.5', '3']);
  });

  it('tags member-access dot as punctuation', () => {
    const tokens = tokenize('{{company.name}}');
    const punct = tokens.filter(t => t.type === 'punctuation');
    expect(punct.map(t => t.text)).toEqual(['.']);
  });

  it('tags call parens and commas distinctly', () => {
    const tokens = tokenize('{{ concat(a.b, c.d) }}');
    const parens = tokens.filter(t => t.type === 'bracket' && (t.text === '(' || t.text === ')'));
    expect(parens.map(t => t.text)).toEqual(['(', ')']);
    const commas = tokens.filter(t => t.type === 'punctuation' && t.text === ',');
    expect(commas).toHaveLength(1);
  });

  it('handles a string literal with an escaped closing quote', () => {
    const tokens = tokenize(`{{ concat("a\\"b") }}`);
    const strings = tokens.filter(t => t.type === 'string');
    expect(strings).toHaveLength(1);
    expect(strings[0]?.text).toContain('a\\"b');
  });

  it('survives an unterminated string at end-of-document without crashing', () => {
    expect(() => tokenize(`{{ concat("never closed `)).not.toThrow();
  });

  it('tokenizes nested function calls (one level)', () => {
    const tokens = tokenize('{{ concat("Total: ", currency(sale.grandTotal)) }}');
    const fns = tokens.filter(t => t.type === 'function');
    expect(fns.map(t => t.text)).toEqual(['concat', 'currency']);
  });

  it('marks stray characters as invalid', () => {
    const types = tokenTypes('{{ sale.grandTotal + 1 }}');
    expect(types).toContain('invalid');
  });

  it('switches in and out of substitution mode across two blocks', () => {
    const tokens = tokenize('Total: {{sale.grandTotal}} – {{date(sale.createdAt)}}');
    const brackets = tokens.filter(t => t.type === 'bracket');
    expect(brackets.map(t => t.text)).toEqual(['{{', '}}', '{{', '(', ')', '}}']);
  });
});

describe('receiptTemplateExtension — extension factory', () => {
  it('returns an array of extensions ready to plug into EditorState.create', () => {
    const ext = receiptTemplateExtension();
    expect(Array.isArray(ext)).toBe(true);
  });

  it('produces a usable EditorState when added to the config', () => {
    expect(() =>
      EditorState.create({
        doc: '{{sale.grandTotal}}',
        extensions: [receiptTemplateExtension()],
      })
    ).not.toThrow();
  });
});
