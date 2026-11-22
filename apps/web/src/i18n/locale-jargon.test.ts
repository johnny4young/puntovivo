import { describe, expect, it } from 'vitest';

const localeFiles = import.meta.glob('./locales/{en,es}/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

// Engineering vocabulary that means nothing to a store owner or cashier.
const JARGON =
  /\b(tenants?|inquilinos?|slices?|rails?|workers?|outbox(es)?|presets?|payloads?|stubs?|surfaces?|superficies?|governance|gobierno)\b/i;

// The design-system page is an internal showcase, and these keys name real
// third-party settings fields the operator has to fill in.
const SKIPPED_NAMESPACES = new Set(['designSystem']);
const ALLOWED = new Set([
  'backupProtection:endpoint',
  'backupProtection:configurationInvalid',
  'backupProtection:connection',
  'externalOrders:endpoint',
  'operationalAlerts:description',
]);

function collect(tree: unknown, prefix: string, out: [string, string][]) {
  if (tree === null || typeof tree !== 'object') return;
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.push([path, value]);
    else collect(value, path, out);
  }
}

describe('locale copy', () => {
  it('keeps internal engineering terms out of user-facing strings', () => {
    const leaks: string[] = [];
    for (const [file, tree] of Object.entries(localeFiles)) {
      const match = file.match(/\.\/locales\/(en|es)\/([^/]+)\.json$/);
      if (!match) continue;
      const [, locale, namespace] = match as [string, string, string];
      if (SKIPPED_NAMESPACES.has(namespace)) continue;
      const leaves: [string, string][] = [];
      collect(tree, '', leaves);
      for (const [path, value] of leaves) {
        const leafKey = path.split('.').pop() ?? path;
        if (ALLOWED.has(`${namespace}:${leafKey}`)) continue;
        const text = value.replace(/\{\{[^}]*\}\}/g, '');
        if (JARGON.test(text)) leaks.push(`${locale}/${namespace}:${path} → ${value}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
