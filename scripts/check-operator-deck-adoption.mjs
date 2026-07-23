#!/usr/bin/env node
/**
 * Operator Deck adoption gate.
 *
 * Runtime TSX must consume the typed Button / buttonVariants and Badge
 * primitives instead of rebuilding the retired pv-btn or badge-* recipes.
 * The primitives remain free to own their internal CSS class contracts.
 *
 * @module scripts/check-operator-deck-adoption
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SOURCE_ROOT = join(REPO_ROOT, 'apps', 'web', 'src');

const RETIRED_RECIPES = [
  { id: 'pv-btn', pattern: /\bpv-btn\b/g },
  {
    id: 'raw-operational-badge',
    pattern: /\b(?:pv-badge|badge-(?:primary|secondary|success|warning|danger))\b/g,
  },
];

const toPosix = value => value.split(sep).join('/');

function isRuntimeTsx(filePath, sourceRoot) {
  if (extname(filePath) !== '.tsx') return false;
  const name = toPosix(relative(sourceRoot, filePath));
  if (/\.(?:test|spec)\.tsx$/.test(name)) return false;
  return name !== 'components/ui/Badge.tsx';
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function scanOperatorDeckSource(source, file = '<source>') {
  const violations = [];
  for (const recipe of RETIRED_RECIPES) {
    for (const match of source.matchAll(recipe.pattern)) {
      const offset = match.index ?? 0;
      const line = source.slice(0, offset).split('\n').length;
      violations.push({ file, line, recipe: recipe.id, match: match[0] });
    }
  }
  return violations;
}

export function auditOperatorDeckAdoption(sourceRoot = DEFAULT_SOURCE_ROOT) {
  return walk(sourceRoot)
    .filter(file => isRuntimeTsx(file, sourceRoot))
    .flatMap(file =>
      scanOperatorDeckSource(readFileSync(file, 'utf8'), toPosix(relative(REPO_ROOT, file)))
    );
}

export function renderOperatorDeckAdoptionReport(violations) {
  if (violations.length === 0) {
    return 'Operator Deck adoption OK: runtime TSX uses typed actions and operational badges.';
  }

  return [
    'Operator Deck adoption regression:',
    ...violations.map(
      violation =>
        `- ${violation.file}:${violation.line} uses ${violation.match} (${violation.recipe})`
    ),
  ].join('\n');
}

function main() {
  const violations = auditOperatorDeckAdoption();
  console.log(renderOperatorDeckAdoptionReport(violations));
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
