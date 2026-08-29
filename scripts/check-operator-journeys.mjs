#!/usr/bin/env node

import { existsSync, globSync, readFileSync } from 'node:fs';
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
  if (contract.version !== 3) issues.push('version must be 3');

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
  const evidenceByJourneyId = new Map();
  const evidenceSources = new Map();

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
    evidenceSources.set(evidencePath, source);
    const titleIndex = findExactTestTitle(source, journey.testTitle);
    if (titleIndex === -1) {
      issues.push(`${label} exact test title drifted in ${journey.evidenceFile}`);
      continue;
    }
    const nextTestIndex = findNextTestDeclaration(source, titleIndex + journey.testTitle.length);
    const evidenceBlock = source.slice(titleIndex, nextTestIndex ?? source.length);
    evidenceByJourneyId.set(journey.id, { journey, evidenceBlock });
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

  const criticalE2E = contract.criticalE2E;
  if (!criticalE2E || typeof criticalE2E !== 'object') {
    issues.push('criticalE2E must be an object');
  } else {
    const tag = criticalE2E.tag;
    if (typeof tag !== 'string' || !/^@[a-z0-9][a-z0-9-]*$/.test(tag)) {
      issues.push('criticalE2E.tag must be a Playwright tag such as @critical');
    }

    const criticalIds = asStringArray(criticalE2E.journeyIds, 'criticalE2E.journeyIds', issues);
    const requiredAreas = asStringArray(
      criticalE2E.requiredAreas,
      'criticalE2E.requiredAreas',
      issues
    );
    if (criticalIds.length > 4) {
      issues.push('criticalE2E must stay small: at most 4 journeys');
    }
    if (new Set(criticalIds).size !== criticalIds.length) {
      issues.push('criticalE2E journey ids must be unique');
    }

    const coveredAreas = new Set();
    for (const id of criticalIds) {
      const evidence = evidenceByJourneyId.get(id);
      if (!evidence) {
        issues.push(`criticalE2E references unknown or invalid journey: ${id}`);
        continue;
      }
      coveredAreas.add(evidence.journey.area);
      if (typeof tag === 'string') {
        const tagPattern = new RegExp('\\btag\\s*:\\s*([\'"`])' + escapeRegExp(tag) + '\\1');
        if (!tagPattern.test(evidence.evidenceBlock.slice(0, 400))) {
          issues.push(`critical journey ${id} is missing the exact ${tag} Playwright tag`);
        }
      }
    }
    for (const area of requiredAreas) {
      if (!coveredAreas.has(area)) {
        issues.push(`criticalE2E does not cover required area: ${area}`);
      }
    }

    if (typeof tag === 'string') {
      const tagPattern = new RegExp('\\btag\\s*:\\s*([\'"`])' + escapeRegExp(tag) + '\\1', 'g');
      const discoveredPaths = options.listE2ESourcePaths
        ? options.listE2ESourcePaths()
        : globSync('e2e/web/**/*.spec.ts', { cwd: repoRoot }).map(path => resolve(repoRoot, path));
      const sourcePaths =
        discoveredPaths.length > 0 ? discoveredPaths : Array.from(evidenceSources.keys());
      const selectedTagCount = Array.from(new Set(sourcePaths)).reduce((count, path) => {
        const source = evidenceSources.get(path) ?? readSource(path);
        return count + (source.match(tagPattern) ?? []).length;
      }, 0);
      if (selectedTagCount !== criticalIds.length) {
        issues.push(
          `criticalE2E tag count ${selectedTagCount} does not match ${criticalIds.length} selected journeys`
        );
      }
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

  const liveUX = contract.liveUXAssertions;
  if (!liveUX || typeof liveUX !== 'object') {
    issues.push('liveUXAssertions must be an object');
  } else {
    const requiredTaskIds = asStringArray(
      liveUX.requiredTaskIds,
      'liveUXAssertions.requiredTaskIds',
      issues
    );
    const assertions = Array.isArray(liveUX.assertions) ? liveUX.assertions : [];
    if (assertions.length === 0) {
      issues.push('liveUXAssertions.assertions must be a non-empty array');
    }
    const taskIds = assertions.map(assertion => assertion?.taskId).filter(Boolean);
    if (new Set(taskIds).size !== taskIds.length) {
      issues.push('liveUXAssertions task ids must be unique');
    }
    for (const taskId of requiredTaskIds) {
      if (!taskIds.includes(taskId)) {
        issues.push(`live UX task is missing: ${taskId}`);
      }
    }

    for (const assertion of assertions) {
      const label = assertion?.taskId
        ? `live UX task ${assertion.taskId}`
        : 'live UX task without id';
      if (!assertion?.taskId || typeof assertion.taskId !== 'string') {
        issues.push(`${label} needs a taskId`);
        continue;
      }
      if (!assertion?.route || typeof assertion.route !== 'string') {
        issues.push(`${label} needs a route`);
      }
      if (!assertion?.evidenceFile || typeof assertion.evidenceFile !== 'string') {
        issues.push(`${label} needs an evidenceFile`);
        continue;
      }
      if (!assertion?.testTitle || typeof assertion.testTitle !== 'string') {
        issues.push(`${label} needs an exact testTitle`);
        continue;
      }
      if (
        !assertion?.firstUsableControlToken ||
        typeof assertion.firstUsableControlToken !== 'string'
      ) {
        issues.push(`${label} needs a firstUsableControlToken`);
        continue;
      }

      const evidencePath = resolve(repoRoot, assertion.evidenceFile);
      if (!existsSync(evidencePath)) {
        issues.push(`${label} evidence file does not exist: ${assertion.evidenceFile}`);
        continue;
      }
      const source = readSource(evidencePath);
      const titleIndex = findExactTestTitle(source, assertion.testTitle);
      if (titleIndex === -1) {
        issues.push(`${label} exact test title drifted in ${assertion.evidenceFile}`);
        continue;
      }
      const nextTestIndex = findNextTestDeclaration(
        source,
        titleIndex + assertion.testTitle.length
      );
      const evidenceBlock = source.slice(titleIndex, nextTestIndex ?? source.length);
      const taskPattern = new RegExp(
        '\\btask\\s*:\\s*([\'"`])' + escapeRegExp(assertion.taskId) + '\\1'
      );
      const routePattern = new RegExp(
        '\\broute\\s*:\\s*([\'"`])' + escapeRegExp(assertion.route) + '\\1'
      );
      if (!evidenceBlock.includes('toHaveURL')) {
        issues.push(`${label} lacks a current-location assertion`);
      }
      if (
        !evidenceBlock.includes(assertion.firstUsableControlToken) ||
        !evidenceBlock.includes('toBeVisible')
      ) {
        issues.push(`${label} lacks its first usable control visibility assertion`);
      }
      if (
        !evidenceBlock.includes('expectTaskMeasurement') ||
        !taskPattern.test(evidenceBlock) ||
        !routePattern.test(evidenceBlock) ||
        !evidenceBlock.includes('backtrackCount:') ||
        !evidenceBlock.includes('validationErrorCount:')
      ) {
        issues.push(`${label} lacks live route, backtracking or validation-error evidence`);
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
    `operator-journeys: PASS — ${contract.journeys.length} shift-defining journeys retain exact evidence; ${contract.criticalE2E.journeyIds.length} tagged critical journeys cover sell, control, close, and stock; ${contract.liveUXAssertions.assertions.length} top-task measurements retain live UX assertions.`
  );
  return 0;
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) process.exit(runOperatorJourneyCheck());
