#!/usr/bin/env node

import { readdir, rm } from 'node:fs/promises';
import { parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function isInside(base, target) {
  // path.relative() across different roots (e.g. separate Windows drive letters)
  // returns an absolute-looking path that does not start with ".." — which would
  // slip past the prefix checks below and let an outside path read as contained.
  // Reject a root/drive mismatch explicitly first (a no-op on POSIX, where every
  // absolute path shares the "/" root).
  if (parse(base).root !== parse(target).root) {
    return false;
  }
  const rel = relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`) && rel !== '..');
}

function assertSafeTarget(target, cwd) {
  const resolved = resolve(cwd, target);
  const root = parse(resolved).root;

  if (resolved === cwd || resolved === root) {
    throw new Error(`Refusing to remove unsafe path: ${target}`);
  }
  if (!isInside(cwd, resolved)) {
    throw new Error(`Refusing to remove path outside the current workspace: ${target}`);
  }
  return resolved;
}

function splitPattern(pattern) {
  const segments = pattern.split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    if (segment.includes('*') && segment !== '*') {
      throw new Error(
        `Unsupported clean glob "${pattern}". Use "*" as a complete path segment.`
      );
    }
  }
  return segments;
}

async function expandSegments(base, segments) {
  if (segments.length === 0) {
    return [base];
  }

  const [head, ...tail] = segments;
  if (head !== '*') {
    return expandSegments(resolve(base, head), tail);
  }

  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return [];
  }

  const expanded = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(entry => expandSegments(resolve(base, entry.name), tail))
  );
  return expanded.flat();
}

export async function resolveCleanTargets(patterns, cwd = process.cwd()) {
  const resolvedCwd = resolve(cwd);
  const expanded = await Promise.all(
    patterns.map(pattern => expandSegments(resolvedCwd, splitPattern(pattern)))
  );
  return [
    ...new Set(
      expanded
        .flat()
        .map(target => assertSafeTarget(target, resolvedCwd))
        .sort()
    ),
  ];
}

export async function cleanPaths(patterns, cwd = process.cwd()) {
  const targets = await resolveCleanTargets(patterns, cwd);
  await Promise.all(targets.map(target => rm(target, { recursive: true, force: true })));
  return targets;
}

async function main() {
  const patterns = process.argv.slice(2);
  if (patterns.length === 0) {
    console.error('Usage: node scripts/clean-paths.mjs <path-or-glob> [...]');
    process.exitCode = 1;
    return;
  }

  const targets = await cleanPaths(patterns);
  for (const target of targets) {
    console.log(`removed ${relative(process.cwd(), target) || target}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
