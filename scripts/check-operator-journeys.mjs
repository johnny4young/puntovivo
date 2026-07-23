#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONTRACT = resolve(REPO_ROOT, 'operator-journeys.json');

function asStringArray(value, label, issues) {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string')) {
    issues.push(`${label} must be a non-empty string array`);
    return [];
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findExactTestTitle(source, title) {
  const pattern = new RegExp(
    '\\btest(?:\\.(?:skip|only|fixme|fail))?\\s*\\(\\s*([\'"`])' + escapeRegExp(title) + '\\1'
  );
  const match = pattern.exec(source);
  if (!match || match.index === undefined) return -1;
  return match.index + match[0].lastIndexOf(title);
}

function findNextTestDeclaration(source, fromIndex) {
  const pattern = /\btest(?:\.(?:skip|only|fixme|fail))?\s*\(/g;
  pattern.lastIndex = fromIndex;
  return pattern.exec(source)?.index;
}

export function validateOperatorJourneyContract(contract, options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const readSource = options.readSource ?? (path => readFileSync(path, 'utf8'));
  const issues = [];

  if (!contract || typeof contract !== 'object') {
    return ['contract must be an object'];
  }
  if (contract.version !== 1) issues.push('version must be 1');

  const requiredIds = asStringArray(contract.requiredJourneyIds, 'requiredJourneyIds', issues);
  const journeys = Array.isArray(contract.journeys) ? contract.journeys : [];
  if (journeys.length === 0) issues.push('journeys must be a non-empty array');

  const ids = journeys.map(journey => journey?.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) issues.push('journey ids must be unique');
  for (const id of requiredIds) {
    if (!ids.includes(id)) issues.push(`required journey is missing: ${id}`);
  }

  const seenAxes = {
    languages: new Set(),
    viewports: new Set(),
    interactionModes: new Set(),
    continuity: new Set(),
  };

  for (const journey of journeys) {
    const label = journey?.id ? `journey ${journey.id}` : 'journey without id';
    if (!journey?.id || typeof journey.id !== 'string') issues.push(`${label} needs an id`);
    if (!journey?.owner || typeof journey.owner !== 'string')
      issues.push(`${label} needs an owner`);
    if (!journey?.area || typeof journey.area !== 'string') issues.push(`${label} needs an area`);
    if (!journey?.evidenceFile || typeof journey.evidenceFile !== 'string') {
      issues.push(`${label} needs an evidenceFile`);
      continue;
    }
    if (!journey?.testTitle || typeof journey.testTitle !== 'string') {
      issues.push(`${label} needs an exact testTitle`);
      continue;
    }

    for (const axis of Object.keys(seenAxes)) {
      const values = asStringArray(journey[axis], `${label}.${axis}`, issues);
      for (const value of values) seenAxes[axis].add(value);
    }

    const evidencePath = resolve(repoRoot, journey.evidenceFile);
    if (!existsSync(evidencePath)) {
      issues.push(`${label} evidence file does not exist: ${journey.evidenceFile}`);
      continue;
    }
    const source = readSource(evidencePath);
    const titleIndex = findExactTestTitle(source, journey.testTitle);
    if (titleIndex === -1) {
      issues.push(`${label} exact test title drifted in ${journey.evidenceFile}`);
      continue;
    }
    const nextTestIndex = findNextTestDeclaration(
      source,
      titleIndex + journey.testTitle.length
    );
    const evidenceBlock = source.slice(titleIndex, nextTestIndex ?? source.length);
    if (
      journey.continuity.includes('reload') &&
      !/\b(?:page|cashierPage|managerPage)\.reload\s*\(|\bensureLanguage\s*\(/.test(evidenceBlock)
    ) {
      issues.push(`${label} declares reload continuity without a reload assertion`);
    }
    if (
      journey.continuity.includes('role-handoff') &&
      !/\bresetSession\s*\(|\.newContext\s*\(|\bcontext\.newPage\s*\(/.test(evidenceBlock)
    ) {
      issues.push(`${label} declares role-handoff continuity without a handoff assertion`);
    }
  }

  const variantAxes = contract.variantAxes ?? {};
  for (const axis of Object.keys(seenAxes)) {
    const required = asStringArray(variantAxes[axis], `variantAxes.${axis}`, issues);
    for (const value of required) {
      if (!seenAxes[axis].has(value)) {
        issues.push(`matrix does not cover ${axis} variant: ${value}`);
      }
    }
  }

  return issues;
}

export function runOperatorJourneyCheck(contractPath = DEFAULT_CONTRACT) {
  let contract;
  try {
    contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch (error) {
    console.error(`operator-journeys: cannot read ${contractPath}: ${error.message}`);
    return 1;
  }
  const issues = validateOperatorJourneyContract(contract);
  if (issues.length > 0) {
    console.error('operator-journeys: FAIL');
    for (const issue of issues) console.error(`- ${issue}`);
    return 1;
  }
  console.log(
    `operator-journeys: PASS — ${contract.journeys.length} critical journeys retain exact executable evidence across the declared operating matrix.`
  );
  return 0;
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) process.exit(runOperatorJourneyCheck());
