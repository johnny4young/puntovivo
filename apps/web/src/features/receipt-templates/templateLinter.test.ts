import { describe, it, expect } from 'vitest';
import { lintTemplate, FUNCTION_ARITY } from './templateLinter';
import { TEMPLATE_FUNCTION_NAMES } from './templateAutocomplete';

describe('lintTemplate — happy path', () => {
  it('produces no diagnostics for plain text outside any substitution', () => {
    expect(lintTemplate('Hello world')).toEqual([]);
  });

  it('produces no diagnostics for valid bare-path substitutions', () => {
    expect(lintTemplate('Total: {{sale.grandTotal}}')).toEqual([]);
    expect(lintTemplate('{{ company.name }}')).toEqual([]);
  });

  it('produces no diagnostics for valid function calls', () => {
    expect(lintTemplate('{{ currency(sale.grandTotal) }}')).toEqual([]);
    expect(lintTemplate("{{ date(sale.createdAt, 'dd/MM/yyyy') }}")).toEqual([]);
    expect(lintTemplate('{{ limit(sale.notes, 30) }}')).toEqual([]);
  });

  it('produces no diagnostics for nested function calls', () => {
    expect(
      lintTemplate("{{ concat('Total: ', currency(sale.grandTotal)) }}")
    ).toEqual([]);
  });
});

describe('lintTemplate — error cases', () => {
  it('flags an unknown namespace at the namespace token', () => {
    const issues = lintTemplate('{{ unknown.field }}');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toEqual({
      kind: 'unknownNamespace',
      namespace: 'unknown',
    });
  });

  it('flags an unknown function name', () => {
    const issues = lintTemplate("{{ totallyFakeFn('x') }}");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toMatchObject({
      kind: 'unknownFunction',
      name: 'totallyFakeFn',
    });
  });

  it('flags wrong arity (too few args)', () => {
    const issues = lintTemplate("{{ limit('hola') }}");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toMatchObject({
      kind: 'wrongArity',
      name: 'limit',
      actual: 1,
    });
  });

  it('flags wrong arity (zero args on a function that needs ≥1)', () => {
    const issues = lintTemplate('{{ upper() }}');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toMatchObject({
      kind: 'wrongArity',
      name: 'upper',
      actual: 0,
    });
  });

  it('flags an unparseable substitution (binary operator not supported)', () => {
    const issues = lintTemplate('{{ sale.grandTotal + 1 }}');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.detail.kind).toBe('unparseable');
  });

  it('flags an unterminated {{ as unparseable', () => {
    const issues = lintTemplate('Hello {{sale.cashier');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail.kind).toBe('unparseable');
  });

  it('flags an empty {{}} as unparseable', () => {
    const issues = lintTemplate('{{}}');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail.kind).toBe('unparseable');
  });

  it('flags a bare identifier without a dot as unparseable', () => {
    const issues = lintTemplate('{{ saleNumber }}');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail.kind).toBe('unparseable');
  });
});

describe('lintTemplate — multiple substitutions in one document', () => {
  it('surfaces issues from every substitution independently', () => {
    const text = '{{ unknown.x }} OK {{ alsoUnknown.y }}';
    const issues = lintTemplate(text);
    expect(issues).toHaveLength(2);
    expect(issues.every(i => i.detail.kind === 'unknownNamespace')).toBe(true);
  });

  it('valid + invalid substitution: only the invalid one is flagged', () => {
    const issues = lintTemplate('{{ sale.x }} {{ unknown.y }}');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.detail).toEqual({
      kind: 'unknownNamespace',
      namespace: 'unknown',
    });
  });
});

describe('lintTemplate — issue offsets', () => {
  it('reports the namespace token range for unknown namespace (not the whole {{}})', () => {
    const text = '{{ unknown.field }}';
    const issues = lintTemplate(text);
    const issue = issues[0]!;
    expect(text.slice(issue.from, issue.to)).toBe('unknown');
  });

  it('reports the function name range for unknown function', () => {
    const text = '{{ totallyFakeFn() }}';
    const issues = lintTemplate(text);
    const issue = issues[0]!;
    expect(text.slice(issue.from, issue.to)).toBe('totallyFakeFn');
  });

  it('reports the call parens range for wrong arity', () => {
    const text = "{{ limit('x') }}";
    const issues = lintTemplate(text);
    const issue = issues[0]!;
    const span = text.slice(issue.from, issue.to);
    // Span should start at `(` and end after `)`.
    expect(span.startsWith('(')).toBe(true);
    expect(span.endsWith(')')).toBe(true);
  });
});

describe('FUNCTION_ARITY — drift detector', () => {
  it('declares an arity for every editor function name', () => {
    for (const name of TEMPLATE_FUNCTION_NAMES) {
      expect(FUNCTION_ARITY).toHaveProperty(name);
      const arity = FUNCTION_ARITY[name]!;
      expect(arity.min).toBeGreaterThanOrEqual(0);
      expect(arity.max).toBeGreaterThanOrEqual(arity.min);
    }
  });

  /**
   * Pin the explicit min/max numbers so a future edit on either side
   * (web FUNCTION_ARITY or server FUNCTION_REGISTRY) flips this test
   * red. The matching server-side test in template-expression.test.ts
   * pins FUNCTION_REGISTRY.<name>.{minArgs,maxArgs} against the same
   * literal table — so a single-side change breaks one of the two
   * tests. Reviewer feedback (node skill) flagged that a symbolic
   * MAX_FUNCTION_ARGS bump server-side would silently propagate
   * without this pin.
   */
  const EXPECTED_ARITY: Record<string, { min: number; max: number }> = {
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

  it('pins the exact min/max numbers per function (drift detector vs server FUNCTION_REGISTRY)', () => {
    for (const [name, expected] of Object.entries(EXPECTED_ARITY)) {
      expect(FUNCTION_ARITY[name]).toEqual(expected);
    }
  });

  it('FUNCTION_ARITY keys are a superset of TEMPLATE_FUNCTION_NAMES (prevents runtime TypeError on the linter non-null assertion)', () => {
    for (const name of TEMPLATE_FUNCTION_NAMES) {
      expect(Object.keys(FUNCTION_ARITY)).toContain(name);
    }
  });
});
