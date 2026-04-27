import { describe, it, expect } from 'vitest';
import {
  NAMESPACE_PROPERTIES,
  TEMPLATE_FUNCTION_NAMES,
  TEMPLATE_NAMESPACES,
  getActiveSubstitution,
  planSuggestions,
} from './templateAutocomplete';

/**
 * The 12 whitelisted function names mirror FUNCTION_REGISTRY in
 * `packages/server/src/services/template-expression.ts`. We can't
 * import the server runtime here (it would pull in fastify / drizzle /
 * better-sqlite3 into the web bundle), so the parity check is split:
 * this test pins the web list to the documented 12 names, and a
 * matching test inside the server suite pins the server list to the
 * same 12 names. Adding a function on either side without updating
 * both fails one of the two tests.
 */
const EXPECTED_FUNCTION_NAMES = [
  'currency',
  'date',
  'upper',
  'lower',
  'round',
  'limit',
  'concat',
  'default',
  'abs',
  'max',
  'min',
  'sum',
] as const;

describe('TEMPLATE_FUNCTION_NAMES — drift detector vs server registry', () => {
  it('exposes exactly the 12 documented function names from the server registry', () => {
    expect([...TEMPLATE_FUNCTION_NAMES].sort()).toEqual(
      [...EXPECTED_FUNCTION_NAMES].sort()
    );
  });
});

describe('NAMESPACE_PROPERTIES catalog', () => {
  it('lists every namespace declared in TEMPLATE_NAMESPACES', () => {
    for (const ns of TEMPLATE_NAMESPACES) {
      expect(NAMESPACE_PROPERTIES).toHaveProperty(ns);
      expect(NAMESPACE_PROPERTIES[ns].length).toBeGreaterThan(0);
    }
  });

  it('mirrors the documented variable whitelist', () => {
    expect(NAMESPACE_PROPERTIES.company).toContain('name');
    expect(NAMESPACE_PROPERTIES.sale).toContain('grandTotal');
    expect(NAMESPACE_PROPERTIES.sale).toContain('createdAt');
    expect(NAMESPACE_PROPERTIES.item).toContain('unitPrice');
    expect(NAMESPACE_PROPERTIES.fiscal).toContain('cufe');
    expect(NAMESPACE_PROPERTIES.tender).toContain('reference');
  });
});

describe('getActiveSubstitution', () => {
  it('returns null when cursor is outside any {{ … }}', () => {
    expect(getActiveSubstitution('plain text', 4)).toBeNull();
  });

  it('returns the substitution when cursor is inside braces', () => {
    const sub = getActiveSubstitution('Hello {{sale.cashier}}!', 14);
    expect(sub).not.toBeNull();
    expect(sub!.start).toBe(6);
    expect(sub!.inner).toBe('sale.cashier');
    expect(sub!.unterminated).toBe(false);
  });

  it('treats unterminated {{ as a substitution stretching to EOF', () => {
    const sub = getActiveSubstitution('Hello {{sale.', 13);
    expect(sub).not.toBeNull();
    expect(sub!.unterminated).toBe(true);
    expect(sub!.inner).toBe('sale.');
  });

  it('skips a closed substitution and inspects the next one', () => {
    const text = '{{first.x}} between {{second.y}}';
    const sub = getActiveSubstitution(text, text.indexOf('second'));
    expect(sub).not.toBeNull();
    expect(sub!.inner).toBe('second.y');
  });
});

describe('planSuggestions', () => {
  it('returns null outside any substitution', () => {
    expect(planSuggestions('Hello world', 4)).toBeNull();
  });

  it('offers all 5 namespaces + 12 functions right after {{', () => {
    const text = '{{}}';
    const plan = planSuggestions(text, 2);
    expect(plan).not.toBeNull();
    const labels = plan!.options.map(o => o.label);
    for (const ns of TEMPLATE_NAMESPACES) expect(labels).toContain(ns);
    for (const fn of TEMPLATE_FUNCTION_NAMES) expect(labels).toContain(fn);
    expect(labels).toHaveLength(TEMPLATE_NAMESPACES.length + TEMPLATE_FUNCTION_NAMES.length);
  });

  it('offers only the namespace + function set with a partial identifier still to filter on', () => {
    // CM6 does the actual filtering against `validFor`; planSuggestions
    // returns the full unfiltered list with from/to pointing at the
    // partial.
    const text = '{{ sa }}';
    const plan = planSuggestions(text, 5);
    expect(plan).not.toBeNull();
    expect(plan!.from).toBe(3);
    expect(plan!.to).toBe(5);
    expect(plan!.options.length).toBeGreaterThan(0);
  });

  it('offers ONLY sale properties after `{{ sale.`', () => {
    const text = '{{ sale. }}';
    const plan = planSuggestions(text, text.indexOf(' }}'));
    expect(plan).not.toBeNull();
    const labels = plan!.options.map(o => o.label);
    expect(labels.sort()).toEqual([...NAMESPACE_PROPERTIES.sale].sort());
  });

  it('offers ONLY company properties after `{{ company.`', () => {
    const text = '{{ company.';
    const plan = planSuggestions(text, text.length);
    expect(plan).not.toBeNull();
    const labels = plan!.options.map(o => o.label);
    expect(labels.sort()).toEqual([...NAMESPACE_PROPERTIES.company].sort());
  });

  it('keeps offering namespace/function set inside a function-call argument', () => {
    const text = '{{ currency() }}';
    const plan = planSuggestions(text, text.indexOf('()') + 1);
    expect(plan).not.toBeNull();
    const labels = plan!.options.map(o => o.label);
    // Inside the parens, no dot yet → namespaces + functions surface.
    expect(labels).toContain('sale');
    expect(labels).toContain('currency');
  });

  it('offers properties when the cursor is inside a nested function arg right after a dot', () => {
    const text = '{{ concat("Total: ", currency(sale.)) }}';
    const dotIdx = text.indexOf('sale.') + 'sale.'.length;
    const plan = planSuggestions(text, dotIdx);
    expect(plan).not.toBeNull();
    const labels = plan!.options.map(o => o.label);
    expect(labels.sort()).toEqual([...NAMESPACE_PROPERTIES.sale].sort());
  });

  it('inspects only the active (cursor-containing) substitution when many are present', () => {
    const text = '{{ sale.grandTotal }} – {{ company. }}';
    const cursor = text.indexOf('company.') + 'company.'.length;
    const plan = planSuggestions(text, cursor);
    expect(plan).not.toBeNull();
    const labels = plan!.options.map(o => o.label);
    expect(labels.sort()).toEqual([...NAMESPACE_PROPERTIES.company].sort());
  });

  it('returns null when cursor is on the {{ boundary character itself', () => {
    // Cursor at offset 1 of `{{...}}` is BEFORE the inner start (which
    // is at offset 2). The function should not surface suggestions yet.
    expect(planSuggestions('{{}}', 1)).toBeNull();
  });

  it('returns null when cursor is past the closing }}', () => {
    expect(planSuggestions('{{sale.x}} after', 'after'.length + 11)).toBeNull();
  });
});
