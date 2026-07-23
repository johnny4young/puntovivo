#!/usr/bin/env node
/**
 * Operator Deck adaptive-mode contract.
 *
 * The shared CSS must keep explicit reduced-motion and forced-colors recipes
 * for overlays, controls, focus, and semantic state surfaces. This small gate
 * prevents an apparently cosmetic refactor from silently removing those modes.
 *
 * @module scripts/check-adaptive-ui
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_COMPONENT_CSS = resolve(REPO_ROOT, 'apps/web/src/styles/components.css');

const CONTRACTS = [
  {
    id: 'reduced-motion',
    media: '@media (prefers-reduced-motion: reduce)',
    requirements: [
      ['drawer animation', '.drawer-shell', 'animation: none'],
      ['control transitions', '.btn-primary', 'transition: none'],
      ['scroll behavior', 'html:focus-within', 'scroll-behavior: auto'],
    ],
  },
  {
    id: 'forced-colors',
    media: '@media (forced-colors: active)',
    requirements: [
      ['system button colors', '.btn-primary', 'HighlightText'],
      ['system focus ring', ':focus-visible', 'outline: 3px solid Highlight'],
      ['semantic strip boundary', '.pv-strip', 'border-left-width: 4px'],
      ['native color adjustment', 'forced-color-adjust: auto'],
    ],
  },
];

function extractMediaBlocks(source, marker) {
  const blocks = [];
  let cursor = 0;
  while ((cursor = source.indexOf(marker, cursor)) !== -1) {
    const open = source.indexOf('{', cursor + marker.length);
    if (open === -1) break;
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      index += 1;
    }
    if (depth === 0) blocks.push(source.slice(cursor, index));
    cursor = index;
  }
  return blocks;
}

function containsScopedRequirement(source, fragments) {
  if (fragments.length === 1) return source.includes(fragments[0]);
  const [selectorFragment, ...declarationFragments] = fragments;
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, declarations] = match;
    if (
      selectors.includes(selectorFragment) &&
      declarationFragments.every(fragment => declarations.includes(fragment))
    ) {
      return true;
    }
  }
  return false;
}

export function auditAdaptiveUi(source) {
  return CONTRACTS.flatMap(contract => {
    const combined = extractMediaBlocks(source, contract.media).join('\n');
    if (!combined) return [`${contract.id}: missing ${contract.media}`];
    return contract.requirements.flatMap(requirement => {
      const fragments = requirement.slice(1);
      return containsScopedRequirement(combined, fragments)
        ? []
        : [`${contract.id}: ${requirement[0]} is missing ${fragments.join(', ')}`];
    });
  });
}

export function renderAdaptiveUiReport(violations) {
  return violations.length === 0
    ? 'Adaptive UI contract OK: reduced motion and forced colors remain operational.'
    : ['Adaptive UI contract regression:', ...violations.map(item => `- ${item}`)].join('\n');
}

function main() {
  const violations = auditAdaptiveUi(readFileSync(DEFAULT_COMPONENT_CSS, 'utf8'));
  console.log(renderAdaptiveUiReport(violations));
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
