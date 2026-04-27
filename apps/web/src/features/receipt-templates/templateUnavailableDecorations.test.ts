import { describe, it, expect } from 'vitest';
import {
  findUnavailableSpans,
  type AvailabilityMap,
} from './templateUnavailableDecorations';

const FISCAL_DISABLED: AvailabilityMap = {
  company: {
    name: true,
    taxId: true,
    address: true,
    phone: true,
    email: true,
    city: false,
  },
  sale: {
    saleNumber: true,
    cashier: true,
    site: true,
    customer: true,
    customerTaxId: true,
    createdAt: true,
    subtotal: true,
    discount: true,
    taxTotal: true,
    tip: true,
    grandTotal: true,
    changeDue: true,
    notes: true,
  },
  item: {
    name: true,
    sku: true,
    qty: true,
    unitPrice: true,
    taxPercent: true,
    discount: true,
    total: true,
  },
  fiscal: {
    cufe: false,
    qrUrl: false,
    resolution: false,
    documentNumber: false,
  },
  tender: {
    method: true,
    amount: true,
    reference: true,
  },
};

const FISCAL_ENABLED: AvailabilityMap = {
  ...FISCAL_DISABLED,
  fiscal: {
    cufe: true,
    qrUrl: true,
    resolution: true,
    documentNumber: true,
  },
};

describe('findUnavailableSpans', () => {
  it('returns no spans for plain text outside any substitution', () => {
    expect(findUnavailableSpans('Hello world', FISCAL_DISABLED)).toEqual([]);
  });

  it('returns no spans for a document with only literal text', () => {
    expect(findUnavailableSpans('No braces here.', FISCAL_DISABLED)).toEqual(
      []
    );
  });

  it('flags fiscal.cufe on a tenant where fiscal is disabled', () => {
    const text = 'Hola {{ fiscal.cufe }} fin';
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.from, spans[0]!.to)).toBe('fiscal.cufe');
    expect(spans[0]!.path).toBe('fiscal.cufe');
  });

  it('does NOT flag fiscal.cufe on a tenant where fiscal is enabled', () => {
    const text = '{{fiscal.cufe}}';
    expect(findUnavailableSpans(text, FISCAL_ENABLED)).toEqual([]);
  });

  it('does NOT flag a populated path even if the namespace contains some unset entries', () => {
    const text = '{{sale.grandTotal}}';
    expect(findUnavailableSpans(text, FISCAL_DISABLED)).toEqual([]);
  });

  it('flags company.city on tenant where city is unset (no schema column today)', () => {
    const text = '{{company.city}}';
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.path).toBe('company.city');
  });

  it('returns multiple spans when several substitutions are unset', () => {
    const text = 'A {{fiscal.cufe}} B {{fiscal.qrUrl}} C';
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans.map(s => s.path)).toEqual(['fiscal.cufe', 'fiscal.qrUrl']);
  });

  it('flags only the inner namespace.path inside a nested function call', () => {
    const text = "{{ concat('CUFE: ', fiscal.cufe) }}";
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.from, spans[0]!.to)).toBe('fiscal.cufe');
  });

  it('does not enter a string literal that contains "{{...}}" syntax', () => {
    // The `concat("fiscal.cufe", sale.cashier)` literal must NOT count
    // as an unavailable path. Only the bare `sale.cashier` is a real
    // path — and it is available.
    const text = `{{ concat("fiscal.cufe", sale.cashier) }}`;
    expect(findUnavailableSpans(text, FISCAL_DISABLED)).toEqual([]);
  });

  it('respects escape sequences inside string literals (do not break early)', () => {
    const text = `{{ concat("she said \\"fiscal.cufe\\"", sale.cashier) }}`;
    expect(findUnavailableSpans(text, FISCAL_DISABLED)).toEqual([]);
  });

  it('handles unterminated `{{` by treating end-of-document as the boundary', () => {
    const text = 'Hola {{ fiscal.cufe';
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.path).toBe('fiscal.cufe');
  });

  it('skips namespaces that the availability map does not declare (defensive)', () => {
    // A stale map missing the `tender` namespace should not over-dim.
    const stale = { ...FISCAL_DISABLED } as AvailabilityMap;
    delete stale.tender;
    const text = '{{tender.method}}';
    expect(findUnavailableSpans(text, stale)).toEqual([]);
  });

  it('does not flag bare identifiers without a dot (linter handles those)', () => {
    expect(findUnavailableSpans('{{ saleNumber }}', FISCAL_DISABLED)).toEqual(
      []
    );
  });

  it('does not flag a function-call name (only path tokens)', () => {
    // currency is a function, not a namespace — must NOT appear in any
    // span even when called with an unset path inside.
    const text = '{{ currency(fiscal.cufe) }}';
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.path).toBe('fiscal.cufe');
  });

  it('respects the `availability` flag for company optional fields', () => {
    const map: AvailabilityMap = {
      ...FISCAL_DISABLED,
      company: {
        ...FISCAL_DISABLED.company!,
        email: false,
      },
    };
    const text = '{{ company.email }}';
    const spans = findUnavailableSpans(text, map);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.path).toBe('company.email');
  });

  it('treats company.name (always true) as available', () => {
    const text = '{{company.name}}';
    expect(findUnavailableSpans(text, FISCAL_DISABLED)).toEqual([]);
  });
});

describe('findUnavailableSpans — offset accuracy', () => {
  it('reports spans relative to the full document, not the inner', () => {
    const text = '   prefix   {{fiscal.cufe}}suffix';
    const spans = findUnavailableSpans(text, FISCAL_DISABLED);
    expect(spans).toHaveLength(1);
    const from = spans[0]!.from;
    const to = spans[0]!.to;
    expect(text.slice(from, to)).toBe('fiscal.cufe');
    // The offsets sit inside the {{ ... }}, not at the document edges.
    expect(from).toBeGreaterThan(text.indexOf('{{'));
    expect(to).toBeLessThan(text.indexOf('}}') + 2);
  });
});
