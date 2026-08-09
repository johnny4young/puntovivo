#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import {
  classifyAuditAdvisories,
  createRuntimeReachabilityIndex,
  extractAuditAdvisories,
  formatRuntimePath,
} from './lib/runtime-dependency-reachability.mjs';

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) {
  console.error('Run the dependency audit through pnpm so its verified runtime can be reused.');
  process.exit(1);
}

function runPnpm(args) {
  return spawnSync(process.execPath, [pnpmEntry, ...args], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
}

function parseJsonOutput(result, label) {
  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} did not return valid JSON: ${result.stderr || result.stdout}`);
  }
}

try {
  const auditResult = runPnpm(['audit', '--audit-level', 'low', '--json']);
  const auditReport = parseJsonOutput(auditResult, 'pnpm audit');
  const advisories = extractAuditAdvisories(auditReport);

  const graphResult = runPnpm(['list', '--prod', '--recursive', '--json', '--depth', 'Infinity']);
  if (graphResult.status !== 0) {
    throw new Error(`pnpm production graph failed: ${graphResult.stderr || graphResult.stdout}`);
  }
  const roots = parseJsonOutput(graphResult, 'pnpm production graph');
  const contract = JSON.parse(
    await readFile(
      new URL('../config/runtime-dependency-reachability.json', import.meta.url),
      'utf8'
    )
  );
  const reachability = createRuntimeReachabilityIndex({ roots, contract });
  const counts = [...reachability.artifactPackageCounts]
    .map(([artifact, count]) => `${artifact}=${count}`)
    .join(', ');

  if (advisories.length === 0) {
    if (auditResult.status !== 0) {
      throw new Error(
        `pnpm audit failed without advisories: ${auditResult.stderr || auditResult.stdout}`
      );
    }
    console.log(`No known vulnerabilities found. Runtime reachability passed: ${counts}.`);
  } else {
    const classified = classifyAuditAdvisories(advisories, reachability);
    for (const advisory of classified) {
      console.error(
        `[${advisory.severity}] ${advisory.packageName} ${advisory.id}: ${advisory.title} (${advisory.classification})`
      );
      for (const path of advisory.runtimePaths) console.error(`  ${formatRuntimePath(path)}`);
      if (advisory.classification === 'not-runtime-reachable') {
        console.error(
          '  No vulnerable version is reachable from a configured production manifest; this does not authorize an exclusion.'
        );
      } else if (advisory.classification === 'unknown') {
        console.error('  Advisory findings did not identify vulnerable installed versions.');
      }
    }
    console.error('Full dependency audit remains fail-closed for every advisory.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
