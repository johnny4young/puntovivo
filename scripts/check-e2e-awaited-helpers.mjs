#!/usr/bin/env node
/**
 * Every async helper in the e2e support modules must have its promise consumed.
 *
 * The e2e directory is outside every lint target (oxlint runs on the three src
 * trees; each workspace eslint config is rooted in its own package), and
 * `no-floating-promises` needs type information oxlint does not carry. So a
 * dropped `await` on an assertion helper is invisible: the spec finishes
 * before the assertion settles, a real failure surfaces as an unhandled
 * rejection attributed to no test, and the journey still reports green. Eight
 * call sites had accumulated that way before this gate existed.
 *
 * Consuming the promise means awaiting it, returning it, storing it, chaining
 * it, or marking the drop deliberate with `void`. A bare call statement is the
 * only shape rejected.
 *
 * @module scripts/check-e2e-awaited-helpers
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const parse = (path, text) =>
  ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true);

/**
 * Names exported as `export async function` from the given support sources.
 *
 * @param {ReadonlyArray<{path: string, text: string}>} sources
 * @returns {Set<string>}
 */
export function collectAsyncHelpers(sources) {
  const helpers = new Set();
  for (const { path, text } of sources) {
    ts.forEachChild(parse(path, text), node => {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) &&
        modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        helpers.add(node.name.text);
      }
    });
  }
  return helpers;
}

/**
 * Call sites that discard one of `helpers` as a bare expression statement.
 *
 * @param {ReadonlyArray<{path: string, text: string}>} sources
 * @param {ReadonlySet<string>} helpers
 * @returns {Array<{path: string, line: number, name: string}>}
 */
export function findDroppedPromises(sources, helpers) {
  const violations = [];
  for (const { path, text } of sources) {
    const source = parse(path, text);
    const visit = node => {
      if (
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        helpers.has(node.expression.expression.text)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({ path, line: line + 1, name: node.expression.expression.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'test-results') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function main() {
  const root = new URL('..', import.meta.url).pathname;
  const files = walk(join(root, 'e2e'));
  const sources = files.map(path => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));
  const helpers = collectAsyncHelpers(sources.filter(s => s.path.includes('/support/')));

  if (helpers.size === 0) {
    console.error(
      'check-e2e-awaited-helpers: found no async support helpers - the gate would pass vacuously.'
    );
    process.exitCode = 1;
    return;
  }

  const violations = findDroppedPromises(sources, helpers);
  if (violations.length > 0) {
    console.error(
      `${violations.length} e2e call(s) drop an async helper's promise. Await the call (or prefix it with void if the drop is deliberate):`
    );
    for (const v of violations) console.error(`  ${v.path}:${v.line}  ${v.name}(...)`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-e2e-awaited-helpers: ${sources.length} files, ${helpers.size} async helpers, all call sites consume their promise.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
