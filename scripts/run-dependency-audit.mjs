#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyAuditAdvisories,
  createRuntimeReachabilityIndex,
  extractAuditAdvisories,
  formatRuntimePath,
  readAuditTransportError,
} from './lib/runtime-dependency-reachability.mjs';
import {
  applyAuditDispositions,
  validateAuditDispositions,
} from './lib/audit-disposition-policy.mjs';
import { resolvePnpmInvocation } from './lib/pnpm-command.mjs';

/**
 * Decide the audit outcome from already-gathered evidence.
 *
 * Extracted from the runner so the fail-closed contract is testable without a
 * registry, a child process, or an installed dependency graph: everything the
 * decision needs arrives as plain data. Returns the exact lines to print
 * rather than printing them, so a test can assert the operator-visible
 * explanation and not just the exit code.
 *
 * @param {{advisories: Array<object>, reachability: object,
 *   dispositions: {byAdvisoryId: Map<string, object>}, auditStatus: number,
 *   auditDiagnostics?: string}} args
 * @returns {{exitCode: number, out: string[], err: string[]}}
 */
export function decideAuditOutcome({
  advisories,
  reachability,
  dispositions,
  auditStatus,
  auditDiagnostics = '',
}) {
  const out = [];
  const err = [];
  const counts = [...reachability.artifactPackageCounts]
    .map(([artifact, count]) => `${artifact}=${count}`)
    .join(', ');

  if (advisories.length === 0) {
    if (auditStatus !== 0) {
      throw new Error(`pnpm audit failed without advisories: ${auditDiagnostics}`);
    }
    // A disposition whose advisory has left the report is stale by the same
    // bidirectional-closure rule the exact-override policy applies: upstream
    // shipped the fix, so the acceptance must not be inherited.
    if (dispositions.byAdvisoryId.size > 0) {
      for (const disposition of dispositions.byAdvisoryId.values()) {
        err.push(
          `Audit disposition ${disposition.advisoryId} (${disposition.packageName}) no longer matches any advisory; remove it from config/audit-dispositions.json.`
        );
      }
      return { exitCode: 1, out, err };
    }
    out.push(`No known vulnerabilities found. Runtime reachability passed: ${counts}.`);
    return { exitCode: 0, out, err };
  }

  const classified = classifyAuditAdvisories(advisories, reachability);
  const { accepted, blocking, stale } = applyAuditDispositions({ classified, dispositions });

  for (const { advisory, disposition } of accepted) {
    out.push(
      `[${advisory.severity}] ${advisory.packageName} ${advisory.id}: ${advisory.title} (accepted until ${disposition.reviewBy})`
    );
    out.push(`  ${disposition.category}: ${disposition.reason}`);
    out.push(`  removal: ${disposition.removalCriteria}`);
  }

  for (const { advisory, refusal } of blocking) {
    err.push(
      `[${advisory.severity}] ${advisory.packageName} ${advisory.id}: ${advisory.title} (${advisory.classification})`
    );
    for (const path of advisory.runtimePaths) err.push(`  ${formatRuntimePath(path)}`);
    if (refusal) {
      err.push(`  Disposition refused: ${refusal}.`);
    } else if (advisory.classification === 'not-runtime-reachable') {
      err.push(
        '  No vulnerable version is reachable from a configured production manifest; this does not authorize an exclusion.'
      );
    } else if (advisory.classification === 'unknown') {
      err.push('  Advisory findings did not identify vulnerable installed versions.');
    }
  }

  for (const disposition of stale) {
    err.push(
      `Audit disposition ${disposition.advisoryId} (${disposition.packageName}) no longer matches any advisory; remove it from config/audit-dispositions.json.`
    );
  }

  if (blocking.length > 0 || stale.length > 0) {
    err.push('Full dependency audit remains fail-closed for every undisposed advisory.');
    return { exitCode: 1, out, err };
  }

  out.push(
    `No blocking vulnerabilities. ${accepted.length} advisory disposition(s) in force; runtime reachability passed: ${counts}.`
  );
  return { exitCode: 0, out, err };
}

/**
 * Direct invocation guard — when imported by the test suite the CLI must NOT
 * execute. Both sides are canonicalised because `import.meta.url` is already
 * realpath-resolved while `process.argv[1]` is not: comparing them raw makes a
 * symlinked invocation look like an import, which would silently skip the
 * whole audit and exit 0. This gate is fail-closed by design, so it must never
 * no-op quietly.
 */
function isInvokedDirectly(argvPath) {
  if (!argvPath) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    // argv[1] does not exist on disk (for example `node --eval`); fall back to
    // the plain comparison rather than assuming a direct run.
    return resolve(argvPath) === modulePath;
  }
}

const isDirectInvocation = isInvokedDirectly(process.argv[1]);

if (isDirectInvocation) {
  const pnpmEntry = process.env.npm_execpath;
  if (!pnpmEntry) {
    console.error('Run the dependency audit through pnpm so its verified runtime can be reused.');
    process.exit(1);
  }
  const pnpmInvocation = resolvePnpmInvocation(pnpmEntry);

  const runPnpm = args =>
    spawnSync(pnpmInvocation.command, [...pnpmInvocation.argsPrefix, ...args], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      shell: pnpmInvocation.shell,
    });

  const parseJsonOutput = (result, label) => {
    if (result.error) throw result.error;
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(`${label} did not return valid JSON: ${result.stderr || result.stdout}`);
    }
  };

  /**
   * A registry timeout is transient, but without a retry a single blip reds
   * every workspace gate in the repository at once. Retry a bounded number of
   * times, then fail closed: no advisory report means no evidence the
   * dependency tree is clean, and this gate never passes on absent evidence.
   */
  const AUDIT_ATTEMPTS = 3;
  const AUDIT_BACKOFF_MS = [5_000, 15_000];
  const sleep = ms => new Promise(done => setTimeout(done, ms));

  const runAuditWithRetries = async () => {
    let lastTransportError = '';
    for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt += 1) {
      const result = runPnpm(['audit', '--audit-level', 'low', '--json']);
      const report = parseJsonOutput(result, 'pnpm audit');
      const transportError = readAuditTransportError(report);
      if (!transportError) return { result, report };
      lastTransportError = transportError;
      if (attempt < AUDIT_ATTEMPTS) {
        const waitMs = AUDIT_BACKOFF_MS[attempt - 1];
        console.error(
          `pnpm audit attempt ${attempt}/${AUDIT_ATTEMPTS} could not reach the advisory registry - ${transportError}; retrying in ${waitMs / 1000}s`
        );
        await sleep(waitMs);
      }
    }
    throw new Error(
      `pnpm audit could not reach the advisory registry after ${AUDIT_ATTEMPTS} attempts - ${lastTransportError}. The gate stays fail-closed.`
    );
  };

  try {
    const { result: auditResult, report: auditReport } = await runAuditWithRetries();
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
    const dispositions = validateAuditDispositions({
      policy: JSON.parse(
        await readFile(new URL('../config/audit-dispositions.json', import.meta.url), 'utf8')
      ),
    });

    const outcome = decideAuditOutcome({
      advisories,
      reachability,
      dispositions,
      auditStatus: auditResult.status,
      auditDiagnostics: auditResult.stderr || auditResult.stdout,
    });
    for (const line of outcome.out) console.log(line);
    for (const line of outcome.err) console.error(line);
    process.exitCode = outcome.exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
