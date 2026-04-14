import { describe, expect, it } from 'vitest';

type LocaleTree = Record<string, unknown>;
type LocaleCode = 'en' | 'es';
type LocaleNamespace = {
  name: string;
  en?: LocaleTree;
  es?: LocaleTree;
};

const localeFiles = import.meta.glob('./locales/{en,es}/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, LocaleTree>;

function buildNamespaces(files: Record<string, LocaleTree>): LocaleNamespace[] {
  const namespaces = new Map<string, LocaleNamespace>();

  for (const [path, tree] of Object.entries(files)) {
    const match = path.match(/\.\/locales\/(en|es)\/([^/]+)\.json$/);
    if (!match) {
      continue;
    }

    const [, locale, name] = match as [string, LocaleCode, string];
    const namespace = namespaces.get(name) ?? { name };
    if (locale === 'en') {
      namespace.en = tree;
    } else {
      namespace.es = tree;
    }
    namespaces.set(name, namespace);
  }

  return Array.from(namespaces.values()).sort((left, right) => left.name.localeCompare(right.name));
}

const namespaces = buildNamespaces(localeFiles);

/**
 * Recursively collect every leaf path (dotted) in a locale tree along with
 * its string value. Non-string leaves are skipped — this test only asserts
 * parity of translatable strings.
 */
function collectLeaves(tree: unknown, prefix = ''): Map<string, string> {
  const leaves = new Map<string, string>();

  if (tree === null || typeof tree !== 'object') {
    return leaves;
  }

  for (const [key, value] of Object.entries(tree as LocaleTree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      leaves.set(path, value);
    } else if (value !== null && typeof value === 'object') {
      for (const [nestedPath, nestedValue] of collectLeaves(value, path)) {
        leaves.set(nestedPath, nestedValue);
      }
    }
  }

  return leaves;
}

/**
 * Extract the set of interpolation variable names from a translation
 * template. `Refund {{name}} for {{amount}}` → `['amount', 'name']` (sorted
 * for deterministic comparison).
 */
function extractInterpolationVars(template: string): string[] {
  const matches = template.matchAll(/\{\{\s*([\w-]+)(?:\s*,[^}]*)?\s*\}\}/g);
  const vars = new Set<string>();
  for (const match of matches) {
    if (match[1]) {
      vars.add(match[1]);
    }
  }
  return Array.from(vars).sort();
}

describe('i18n locale parity helpers', () => {
  it('buildNamespaces discovers locale files without a hand-maintained namespace list', () => {
    expect(namespaces.map(namespace => namespace.name)).toContain('common');
    expect(namespaces.map(namespace => namespace.name)).toContain('sales');
  });

  it('collectLeaves walks nested string leaves and ignores non-strings', () => {
    const leaves = collectLeaves({
      a: 'one',
      b: { c: 'two', d: { e: 'three' } },
      ignored: 42,
      alsoIgnored: null,
    });
    expect(Array.from(leaves.entries())).toEqual([
      ['a', 'one'],
      ['b.c', 'two'],
      ['b.d.e', 'three'],
    ]);
  });

  it('extractInterpolationVars returns a sorted, deduped variable list', () => {
    expect(extractInterpolationVars('Hello {{name}}, you owe {{amount}}.')).toEqual([
      'amount',
      'name',
    ]);
    expect(extractInterpolationVars('{{count}} item · {{count}} total')).toEqual(['count']);
    expect(extractInterpolationVars('No interpolation here')).toEqual([]);
  });

  it('extractInterpolationVars supports the i18next formatter syntax', () => {
    // `{{count, number}}` / `{{date, datetime}}` are valid i18next formatters.
    expect(extractInterpolationVars('{{count, number}} items')).toEqual(['count']);
  });
});

describe('i18n locale parity', () => {
  for (const namespace of namespaces) {
    describe(`namespace: ${namespace.name}`, () => {
      const enLeaves = collectLeaves(namespace.en ?? {});
      const esLeaves = collectLeaves(namespace.es ?? {});

      it('exists in both locale directories', () => {
        expect({
          en: namespace.en !== undefined,
          es: namespace.es !== undefined,
        }).toEqual({ en: true, es: true });
      });

      it('has no keys present in EN but missing in ES', () => {
        const missingInEs = Array.from(enLeaves.keys()).filter(
          key => !esLeaves.has(key)
        );
        expect(missingInEs).toEqual([]);
      });

      it('has no keys present in ES but missing in EN', () => {
        const missingInEn = Array.from(esLeaves.keys()).filter(
          key => !enLeaves.has(key)
        );
        expect(missingInEn).toEqual([]);
      });

      it('has matching interpolation variables on every shared key', () => {
        const mismatches: Array<{
          key: string;
          en: string[];
          es: string[];
        }> = [];

        for (const [key, enValue] of enLeaves) {
          const esValue = esLeaves.get(key);
          if (esValue === undefined) {
            continue; // reported by the missing-keys tests above
          }
          const enVars = extractInterpolationVars(enValue);
          const esVars = extractInterpolationVars(esValue);
          if (JSON.stringify(enVars) !== JSON.stringify(esVars)) {
            mismatches.push({ key, en: enVars, es: esVars });
          }
        }

        expect(mismatches).toEqual([]);
      });

      it('has no empty string values (likely missing translations)', () => {
        const emptyEn = Array.from(enLeaves.entries())
          .filter(([, value]) => value.trim() === '')
          .map(([key]) => key);
        const emptyEs = Array.from(esLeaves.entries())
          .filter(([, value]) => value.trim() === '')
          .map(([key]) => key);

        expect({ en: emptyEn, es: emptyEs }).toEqual({ en: [], es: [] });
      });
    });
  }
});
