import { describe, it, expect } from 'vitest';
import {
  parseTemplate,
  evaluateTemplate,
  evaluateExpression,
  validateTemplate,
  applyDatePattern,
  FUNCTION_REGISTRY,
  MAX_EXPRESSION_LENGTH,
  MAX_FUNCTION_ARGS,
  type EvalContext,
  type ExpressionNode,
} from '../services/template-expression.js';

const ALLOWED = new Set(['company', 'sale', 'item', 'fiscal', 'tender']);
const URL_SCHEMES = /^(javascript|data|vbscript|file):/i;

const buildCtx = (overrides: Partial<EvalContext> = {}): EvalContext => ({
  lookupPath: () => undefined,
  ...overrides,
});

const sampleData: Record<string, unknown> = {
  company: { name: 'Demo Co', taxId: '900.123.456-7' },
  sale: {
    grandTotal: 12345.67,
    notes: 'Compra urgente con detalles que pasan de 30 caracteres',
    cashier: 'Ana Pérez',
    // ISO local time (no `Z` / TZ offset) — parsed as local per spec, so
    // `applyDatePattern` reads the same year/month/day across CI runners
    // regardless of `process.env.TZ`. Anchors the date-pattern assertions
    // below at exactly 2026-04-25.
    createdAt: '2026-04-25T15:30:45',
  },
  fiscal: { cufe: '' },
};

const lookupSample: EvalContext['lookupPath'] = path => {
  const segs = path.split('.');
  let cur: unknown = sampleData;
  for (const seg of segs) {
    if (cur && typeof cur === 'object' && seg in cur) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
};

// ---------------------------------------------------------------------------
// Tokenizer / parser
// ---------------------------------------------------------------------------

describe('parseTemplate — tokenizer + recursive descent', () => {
  it('parses bare path substitution', () => {
    const r = parseTemplate('Total: {{sale.grandTotal}}');
    expect(r.errors).toEqual([]);
    expect(r.nodes).toHaveLength(2);
    expect(r.nodes[0]).toEqual({ type: 'literal', value: 'Total: ' });
    expect(r.nodes[1]).toMatchObject({
      type: 'substitution',
      expression: { type: 'path', segments: ['sale', 'grandTotal'] },
    });
  });

  it('parses function call with mixed arg types', () => {
    const r = parseTemplate("{{ limit(sale.notes, 30) }} {{concat('x:', 1, 2.5)}}");
    expect(r.errors).toEqual([]);
    const sub1 = r.nodes[0] as { expression: ExpressionNode };
    expect(sub1.expression).toMatchObject({
      type: 'funcCall',
      name: 'limit',
      args: [
        { type: 'path', segments: ['sale', 'notes'] },
        { type: 'number', value: 30 },
      ],
    });
    const sub2 = r.nodes[2] as { expression: ExpressionNode };
    expect(sub2.expression).toMatchObject({
      type: 'funcCall',
      name: 'concat',
      args: [
        { type: 'string', value: 'x:' },
        { type: 'number', value: 1 },
        { type: 'number', value: 2.5 },
      ],
    });
  });

  it('parses nested function calls (one level)', () => {
    const r = parseTemplate(
      "{{ concat('Total: ', currency(sale.grandTotal)) }}"
    );
    expect(r.errors).toEqual([]);
    const expr = (r.nodes[0] as { expression: ExpressionNode }).expression;
    expect(expr).toMatchObject({
      type: 'funcCall',
      name: 'concat',
      args: [
        { type: 'string', value: 'Total: ' },
        {
          type: 'funcCall',
          name: 'currency',
          args: [{ type: 'path', segments: ['sale', 'grandTotal'] }],
        },
      ],
    });
  });

  it('tolerates inner whitespace', () => {
    const r = parseTemplate('{{   limit(  sale.notes  ,  10  )   }}');
    expect(r.errors).toEqual([]);
    const expr = (r.nodes[0] as { expression: ExpressionNode }).expression;
    expect(expr).toMatchObject({
      type: 'funcCall',
      name: 'limit',
      args: [
        { type: 'path', segments: ['sale', 'notes'] },
        { type: 'number', value: 10 },
      ],
    });
  });

  it('parses double-quoted, single-quoted strings and escape sequences', () => {
    const r = parseTemplate(
      `{{ concat("a\\"b", 'c\\'d', '\\n', '\\\\') }}`
    );
    expect(r.errors).toEqual([]);
    const expr = (r.nodes[0] as { expression: ExpressionNode }).expression;
    expect(expr).toMatchObject({
      type: 'funcCall',
      name: 'concat',
      args: [
        { type: 'string', value: 'a"b' },
        { type: 'string', value: "c'd" },
        { type: 'string', value: '\n' },
        { type: 'string', value: '\\' },
      ],
    });
  });

  it('parses negative numbers and decimals', () => {
    const r = parseTemplate('{{ max(-1, -2.5, 3) }}');
    expect(r.errors).toEqual([]);
    const expr = (r.nodes[0] as { expression: ExpressionNode }).expression;
    expect(expr).toMatchObject({
      type: 'funcCall',
      name: 'max',
      args: [
        { type: 'number', value: -1 },
        { type: 'number', value: -2.5 },
        { type: 'number', value: 3 },
      ],
    });
  });

  it('rejects empty {{}}', () => {
    const r = parseTemplate('{{}}');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/Empty/);
  });

  it('rejects unterminated {{', () => {
    const r = parseTemplate('Hello {{sale.cashier');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.message).toMatch(/Unterminated/);
  });

  it('rejects bare identifier without dot', () => {
    const r = parseTemplate('{{ saleNumber }}');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.message).toMatch(/at least one dot/);
  });

  it('rejects unterminated function call', () => {
    const r = parseTemplate('{{ limit(sale.notes, 30 }}');
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects unknown character', () => {
    const r = parseTemplate('{{ sale.grandTotal + 1 }}');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.message).toMatch(/Unexpected character/);
  });

  it('rejects expression beyond the length cap', () => {
    const padding = 'a'.repeat(MAX_EXPRESSION_LENGTH);
    const r = parseTemplate(`{{ concat('${padding}') }}`);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.message).toMatch(/exceeds/);
  });

  it('rejects function with too many arguments', () => {
    const args = Array.from({ length: MAX_FUNCTION_ARGS + 1 }, (_, i) => i + 1).join(
      ', '
    );
    const r = parseTemplate(`{{ sum(${args}) }}`);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects deeply nested expressions beyond the recursion cap', () => {
    const expr = 'concat('.repeat(5) + "'x'" + ')'.repeat(5);
    const r = parseTemplate(`{{ ${expr} }}`);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.message).toMatch(/nested/);
  });

  it('preserves multiple substitutions in one template', () => {
    const r = parseTemplate('{{company.name}} | {{sale.cashier}}');
    expect(r.errors).toEqual([]);
    expect(r.nodes).toHaveLength(3);
  });

  it('treats unparseable substitutions as literal raw text in the node stream', () => {
    const r = parseTemplate('{{}} after');
    expect(r.errors.length).toBe(1);
    expect(r.nodes[0]).toEqual({ type: 'literal', value: '{{}}' });
    expect(r.nodes[1]).toEqual({ type: 'literal', value: ' after' });
  });
});

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

describe('evaluateTemplate — variable substitution and functions', () => {
  it('renders bare path identical to legacy behavior', () => {
    expect(
      evaluateTemplate('Cashier: {{sale.cashier}}', buildCtx({ lookupPath: lookupSample }))
    ).toBe('Cashier: Ana Pérez');
  });

  it('renders missing path as empty string', () => {
    expect(
      evaluateTemplate('CUFE: {{fiscal.cufe}}', buildCtx({ lookupPath: lookupSample }))
    ).toBe('CUFE: ');
    expect(
      evaluateTemplate('Missing: {{sale.nonexistent}}', buildCtx({ lookupPath: lookupSample }))
    ).toBe('Missing: ');
  });

  it('runs upper / lower / round / abs', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    expect(evaluateTemplate("{{ upper('hola') }}", ctx)).toBe('HOLA');
    expect(evaluateTemplate("{{ lower('HOLA') }}", ctx)).toBe('hola');
    expect(evaluateTemplate('{{ round(1.2345, 2) }}', ctx)).toBe('1.23');
    expect(evaluateTemplate('{{ round(1.5) }}', ctx)).toBe('2');
    expect(evaluateTemplate('{{ abs(-7.5) }}', ctx)).toBe('7.5');
  });

  it('runs limit with truncation and short-input passthrough', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    const face = '\u{1F642}';
    expect(evaluateTemplate('{{ limit(sale.notes, 30) }}', ctx)).toBe(
      'Compra urgente con detalles...'
    );
    expect(evaluateTemplate("{{ limit('hola', 10) }}", ctx)).toBe('hola');
    expect(evaluateTemplate("{{ limit('hola mundo', 9) }}", ctx)).toBe('hola m...');
    expect(evaluateTemplate("{{ limit('abc', 2) }}", ctx)).toBe('ab');
    expect(evaluateTemplate(`{{ limit('${face.repeat(4)}', 4) }}`, ctx)).toBe(
      face.repeat(4)
    );
    expect(evaluateTemplate(`{{ limit('${face.repeat(4)}', 3) }}`, ctx)).toBe(
      face.repeat(3)
    );
  });

  it('runs concat across literals, paths and nested calls', () => {
    const ctx = buildCtx({
      lookupPath: lookupSample,
      formatCurrency: v => `$${v.toFixed(2)}`,
    });
    expect(
      evaluateTemplate(
        "{{ concat('Total: ', currency(sale.grandTotal)) }}",
        ctx
      )
    ).toBe('Total: $12345.67');
  });

  it('runs default with empty fallback and present value', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    expect(
      evaluateTemplate("{{ default(fiscal.cufe, 'Sin CUFE') }}", ctx)
    ).toBe('Sin CUFE');
    expect(
      evaluateTemplate("{{ default(sale.cashier, 'N/A') }}", ctx)
    ).toBe('Ana Pérez');
  });

  it('runs max / min / sum on number args', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    expect(evaluateTemplate('{{ max(1, 5, 3) }}', ctx)).toBe('5');
    expect(evaluateTemplate('{{ min(1, 5, 3) }}', ctx)).toBe('1');
    expect(evaluateTemplate('{{ sum(1, 2, 3, 4) }}', ctx)).toBe('10');
  });

  it('falls back to toFixed(2) when no formatCurrency is provided', () => {
    expect(
      evaluateTemplate('{{ currency(sale.grandTotal) }}', buildCtx({ lookupPath: lookupSample }))
    ).toBe('12345.67');
    expect(
      evaluateTemplate('{{ currency(sale.grandTotal, 0) }}', buildCtx({ lookupPath: lookupSample }))
    ).toBe('12346');
  });

  it('uses the provided formatCurrency callback when present', () => {
    const ctx = buildCtx({
      lookupPath: lookupSample,
      formatCurrency: (v, decimals) =>
        `COP ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: decimals ?? 0 }).format(v)}`,
    });
    expect(
      evaluateTemplate('{{ currency(sale.grandTotal) }}', ctx)
    ).toMatch(/^COP /);
  });

  it('formats date with default and explicit pattern', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    const iso = evaluateTemplate('{{ date(sale.createdAt) }}', ctx);
    expect(iso).toBe('2026-04-25');
    const latam = evaluateTemplate(
      "{{ date(sale.createdAt, 'dd/MM/yyyy') }}",
      ctx
    );
    expect(latam).toBe('25/04/2026');
  });

  it('renders empty string when date input is invalid', () => {
    const ctx = buildCtx({
      lookupPath: () => 'not a date',
    });
    expect(evaluateTemplate('{{ date(sale.createdAt) }}', ctx)).toBe('');
  });

  it('combines multiple substitutions and literals deterministically', () => {
    const ctx = buildCtx({
      lookupPath: lookupSample,
      formatCurrency: v => `$${v.toFixed(2)}`,
    });
    expect(
      evaluateTemplate(
        '{{ upper(company.name) }} -- {{ currency(sale.grandTotal, 2) }}',
        ctx
      )
    ).toBe('DEMO CO -- $12345.67');
  });

  it('returns empty string when the function name is unknown at eval time', () => {
    const node: ExpressionNode = {
      type: 'funcCall',
      name: 'definitelyNotAFn',
      args: [],
    };
    // Eval is defensive — it should not throw even if a malformed AST slips
    // past validation.
    expect(evaluateExpression(node, buildCtx({ lookupPath: lookupSample }))).toBe('');
  });

  it('clamps round() decimals so Math.pow(10, huge) cannot produce NaN', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    expect(evaluateTemplate('{{ round(1.234, 1000) }}', ctx)).not.toBe('');
    expect(evaluateTemplate('{{ round(1.234, 1000) }}', ctx)).not.toBe('NaN');
  });

  it('clamps currency() decimals so toFixed(huge) cannot throw RangeError', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    expect(() =>
      evaluateTemplate('{{ currency(sale.grandTotal, 1000) }}', ctx)
    ).not.toThrow();
  });

  it('returns empty when arity is wrong even if validation was bypassed', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    // Forge an AST with 1 arg for limit() (which needs exactly 2). Going
    // straight to evaluateExpression skips validateTemplate, simulating a
    // future caller that emits AST nodes directly without going through
    // parseTemplate.
    const node: ExpressionNode = {
      type: 'funcCall',
      name: 'limit',
      args: [{ type: 'string', value: 'hola' }],
    };
    expect(evaluateExpression(node, ctx)).toBe('');
  });

  it('lookupPath blocks prototype-chain access', () => {
    // The renderer's `lookupPath` uses Object.prototype.hasOwnProperty.call
    // so segments like `__proto__`, `constructor`, `toString` cannot leak.
    // Build a synthetic ctx that reuses the renderer-style lookup.
    const ctx = buildCtx({
      lookupPath: path => {
        const segs = path.split('.');
        let cur: unknown = sampleData;
        for (const seg of segs) {
          if (
            cur &&
            typeof cur === 'object' &&
            Object.prototype.hasOwnProperty.call(cur, seg)
          ) {
            cur = (cur as Record<string, unknown>)[seg];
          } else {
            return undefined;
          }
        }
        return cur;
      },
    });
    // sale.cashier resolves to a string. Trying to walk into the string's
    // prototype must NOT yield "function String() { ... }" or similar.
    expect(
      evaluateTemplate('{{ sale.cashier.constructor }}', ctx)
    ).toBe('');
    expect(evaluateTemplate('{{ sale.__proto__ }}', ctx)).toBe('');
    expect(evaluateTemplate('{{ company.toString }}', ctx)).toBe('');
  });

  it('limit() with max=0 returns the empty string (corner case)', () => {
    const ctx = buildCtx({ lookupPath: lookupSample });
    expect(evaluateTemplate("{{ limit('hola', 0) }}", ctx)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Validation (Zod refinement entry point)
// ---------------------------------------------------------------------------

describe('validateTemplate — Zod refinement', () => {
  it('accepts a valid bare path when the namespace is allowed', () => {
    expect(
      validateTemplate('{{ sale.grandTotal }}', { allowedNamespaces: ALLOWED })
    ).toEqual([]);
  });

  it('rejects unknown namespaces', () => {
    const issues = validateTemplate('{{ unknown.field }}', {
      allowedNamespaces: ALLOWED,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/unknown namespace/);
  });

  it('rejects unknown functions', () => {
    const issues = validateTemplate("{{ notARealFn('hi') }}", {
      allowedNamespaces: ALLOWED,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/Unknown function/);
  });

  it('rejects wrong arity', () => {
    expect(
      validateTemplate("{{ upper() }}", { allowedNamespaces: ALLOWED })
    ).toHaveLength(1);
    expect(
      validateTemplate("{{ limit('hola') }}", { allowedNamespaces: ALLOWED })
    ).toHaveLength(1);
    expect(
      validateTemplate("{{ default('a') }}", { allowedNamespaces: ALLOWED })
    ).toHaveLength(1);
  });

  it('accepts whitelisted functions across all listed names', () => {
    for (const name of Object.keys(FUNCTION_REGISTRY)) {
      const spec = FUNCTION_REGISTRY[name]!;
      const args = Array.from({ length: spec.minArgs }, (_, i) =>
        name === 'default' || name === 'limit' || name === 'concat' || name === 'upper' || name === 'lower' || name === 'date'
          ? `'arg${i}'`
          : '1'
      ).join(', ');
      const issues = validateTemplate(`{{ ${name}(${args}) }}`, {
        allowedNamespaces: ALLOWED,
      });
      expect(issues, `validate ${name}`).toEqual([]);
    }
  });

  it('rejects string literals that match the URL scheme blocklist', () => {
    const issues = validateTemplate(
      `{{ concat('javascript:', sale.cashier) }}`,
      { allowedNamespaces: ALLOWED, rejectStringScheme: URL_SCHEMES }
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toMatch(/disallowed URL scheme/);
  });

  it('does not raise URL-scheme issues when the option is not set', () => {
    expect(
      validateTemplate("{{ concat('javascript:', sale.cashier) }}", {
        allowedNamespaces: ALLOWED,
      })
    ).toEqual([]);
  });

  it('flags namespaces inside nested function arguments', () => {
    const issues = validateTemplate(
      "{{ concat('Code: ', upper(unknown.field)) }}",
      { allowedNamespaces: ALLOWED }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/unknown namespace/);
  });

  it('passes through tokenizer-level errors as validation issues', () => {
    const issues = validateTemplate('{{ sale.notes + 1 }}', {
      allowedNamespaces: ALLOWED,
    });
    expect(issues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Date pattern engine
// ---------------------------------------------------------------------------

describe('applyDatePattern — single-pass token replacement', () => {
  const fixed = new Date('2026-04-25T15:30:45.000Z');
  // Adjust for local timezone — the function reads local components.
  const localPattern = (p: string) => applyDatePattern(fixed, p);

  it('formats yyyy-MM-dd', () => {
    const out = localPattern('yyyy-MM-dd');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formats dd/MM/yyyy', () => {
    const out = localPattern('dd/MM/yyyy');
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('formats HH:mm:ss', () => {
    const out = localPattern('HH:mm:ss');
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('preserves literal characters between tokens', () => {
    const out = localPattern("'fecha:' yyyy-MM-dd 'hora:' HH:mm");
    expect(out).toMatch(/^'fecha:' \d{4}-\d{2}-\d{2} 'hora:' \d{2}:\d{2}$/);
  });

  it('does not double-replace tokens', () => {
    // After replacing yyyy → 2026, the digits 2/0/2/6 must not become MM
    // candidates. Single-pass replacement keeps this invariant.
    const out = applyDatePattern(new Date('2026-04-25T00:00:00Z'), 'yyyyMMdd');
    expect(out.length).toBe(8);
  });
});
