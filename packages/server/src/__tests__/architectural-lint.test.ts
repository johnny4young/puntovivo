/**
 * ENG-020 — Architectural lint.
 *
 * A static guard that fails CI when any file under
 * `trpc/routers/reports/` names `customers` or `products` in its
 * import list from `db/schema.js`. The buyer + line snapshots on
 * `fiscal_documents` + `fiscal_document_items` are deliberately
 * frozen at emission time; joining `customers` / `products` would
 * silently re-introduce a mutation coupling and violate the DIAN
 * Resolución 165/2023 immutability contract.
 *
 * This is the first architectural-lint test in the repo — follow the
 * same pattern for future invariants (e.g. "payments must not
 * import stock tables") by adding more cases.
 *
 * The lint is deliberately regex-based rather than AST-based:
 *
 *   - Every `import ... from '<db/schema>'` in the file is scanned.
 *   - The named-import list is checked for the forbidden identifiers.
 *   - Barrel re-exports are out of scope (this is a file-local check).
 *
 * If a legitimate future need arises to reference those tables from
 * a reports surface (e.g. a dashboard row that *counts* customers),
 * prefer a service helper that takes an id list and does the join
 * in a non-reports module; the lint intentionally does NOT provide
 * an allowlist.
 *
 * @module __tests__/architectural-lint
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPORTS_DIR = fileURLToPath(
  new URL('../trpc/routers/reports/', import.meta.url)
);

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract every named import the file pulls from the schema module
 * (both `'../../../db/schema.js'` and `'../../db/schema.js'` relative
 * specifiers are matched). Returns a flat list of identifier names.
 */
function namedImportsFromSchema(source: string): string[] {
  const identifiers: string[] = [];
  const importRe =
    /import\s*(?:type\s*)?\{([\s\S]*?)\}\s*from\s*['"][^'"]*db\/schema\.js['"]\s*;/g;
  for (const match of source.matchAll(importRe)) {
    const list = match[1] ?? '';
    for (const raw of list.split(',')) {
      const cleaned = raw.trim().replace(/^type\s+/, '');
      if (!cleaned) continue;
      // Handle `foo as bar` — we only care about the left side because
      // that is what the file actually pulls from the module.
      const name = cleaned.split(/\s+as\s+/)[0]!.trim();
      if (name) identifiers.push(name);
    }
  }
  return identifiers;
}

const FORBIDDEN_IN_REPORTS = new Set(['customers', 'products']);

describe('architectural lint (ENG-020)', () => {
  it('covers the reports directory with at least one file', () => {
    const files = walkTsFiles(REPORTS_DIR);
    // Sanity check — we want the test to fail if someone accidentally
    // deletes the reports folder or renames it without updating the
    // lint, rather than silently passing.
    expect(files.length).toBeGreaterThan(0);
  });

  it('forbids trpc/routers/reports/** from importing `customers` or `products` from db/schema', () => {
    const offenders: Array<{ file: string; identifier: string }> = [];
    for (const file of walkTsFiles(REPORTS_DIR)) {
      const source = readFileSync(file, 'utf8');
      const named = namedImportsFromSchema(source);
      for (const name of named) {
        if (FORBIDDEN_IN_REPORTS.has(name)) {
          offenders.push({ file, identifier: name });
        }
      }
    }
    if (offenders.length > 0) {
      const lines = offenders.map(
        o => `  - ${o.file.replace(REPORTS_DIR, 'reports/')} imports \`${o.identifier}\``
      );
      throw new Error(
        [
          `Architectural invariant violated (ENG-020):`,
          ``,
          `  Files under \`trpc/routers/reports/\` must NOT import`,
          `  \`customers\` or \`products\` from \`db/schema.js\`. The`,
          `  buyer + line snapshots on \`fiscal_documents\` and`,
          `  \`fiscal_document_items\` are frozen at emission time.`,
          `  Joining \`customers\` / \`products\` would silently`,
          `  re-couple the fiscal surface to mutable source rows and`,
          `  violate DIAN Resolución 165/2023 immutability.`,
          ``,
          `Offending imports:`,
          ...lines,
        ].join('\n')
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it('regex correctly flags a synthetic import of customers/products', () => {
    // Smoke-tests the detector itself so a future refactor of the
    // regex cannot accidentally neutralize the lint without failing.
    const synthetic = `
import {
  fiscalDocuments,
  customers,
  type Foo,
} from '../../../db/schema.js';
`;
    expect(namedImportsFromSchema(synthetic)).toContain('customers');

    const negative = `
import {
  fiscalDocuments,
  fiscalDocumentItems,
} from '../../../db/schema.js';
`;
    expect(namedImportsFromSchema(negative)).not.toContain('customers');
    expect(namedImportsFromSchema(negative)).not.toContain('products');
  });
});
