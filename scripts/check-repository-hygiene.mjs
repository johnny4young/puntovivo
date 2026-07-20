#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INTERNAL_PREFIXES = [
  ['E', 'NG'],
  ['W', 'C'],
  ['A', 'PI'],
  ['D', 'B'],
  ['D', 'K'],
  ['S', 'EC'],
  ['U', 'I'],
  ['B', 'UG'],
  ['A', 'UDIT'],
  ['C', 'ASH'],
  ['S', 'ALES'],
  ['Q', 'UOT'],
].map(parts => parts.join(''));
const INTERNAL_TICKET_PATTERN = new RegExp(
  `\\b(?:${INTERNAL_PREFIXES.join('|')})-[0-9]{2,}[A-Za-z0-9.-]*\\b`
);
const PRIVATE_PATH_PATTERNS = [
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^\.agents\//,
  /^\.claude\//,
  /^docs\/(?:planning|private)\//,
  /^docs\/(?:ANALYSIS|AUDIT|HANDOFF|PLAN|ROADMAP|BACKLOG|SPRINT|STRATEGY)[^/]*\.md$/i,
];

export function inspectRepositoryFile(path, content) {
  const violations = [];
  if (PRIVATE_PATH_PATTERNS.some(pattern => pattern.test(path))) {
    violations.push('private planning or agent path is tracked');
  }
  if (INTERNAL_TICKET_PATTERN.test(content)) {
    violations.push('internal ticket identifier is present');
  }
  return violations;
}

const MARKDOWN_LINK_PATTERN = /!?\[[^\]]*\]\(([^)]+)\)/g;

export function inspectMarkdownLinks(cwd, path, content) {
  if (!/\.md$/i.test(path)) return [];
  const violations = [];
  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1);
    } else {
      target = target.split(/\s+["']/u, 1)[0];
    }
    if (
      target.length === 0 ||
      target.startsWith('#') ||
      /^[a-z][a-z0-9+.-]*:/i.test(target) ||
      target.startsWith('//')
    ) {
      continue;
    }
    const pathOnly = target.split('#', 1)[0].split('?', 1)[0];
    if (!pathOnly) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(pathOnly);
    } catch {
      decoded = pathOnly;
    }
    if (!existsSync(resolve(cwd, dirname(path), decoded))) {
      violations.push(`dead Markdown link: ${target}`);
    }
  }
  return violations;
}

export function listVersionedAndCandidateFiles(cwd) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd }
  );
  return output.toString('utf8').split('\0').filter(Boolean);
}

export function auditRepository(cwd) {
  const violations = [];
  for (const path of listVersionedAndCandidateFiles(cwd)) {
    let content;
    try {
      const buffer = readFileSync(resolve(cwd, path));
      if (buffer.includes(0)) continue;
      content = buffer.toString('utf8');
    } catch {
      continue;
    }
    for (const reason of inspectRepositoryFile(path, content)) {
      violations.push({ path, reason });
    }
    for (const reason of inspectMarkdownLinks(cwd, path, content)) {
      violations.push({ path, reason });
    }
  }
  return violations;
}

export function runCli(cwd = process.cwd()) {
  const violations = auditRepository(cwd);
  if (violations.length > 0) {
    console.error('Repository hygiene check failed:');
    for (const violation of violations) {
      console.error(`- ${violation.path}: ${violation.reason}`);
    }
    return 1;
  }
  console.log('Repository hygiene check passed.');
  return 0;
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  process.exitCode = runCli();
}
