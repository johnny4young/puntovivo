#!/usr/bin/env node
/** Validate one sanitized Gate 5 manifest against its retained local artifacts. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validatePassingRepresentativeInstallEvidence } from './lib/representative-install-evidence.mjs';

function parseArgs(argv) {
  const options = {
    evidence: null,
    artifactsDir: null,
    candidateSha: null,
    candidateVersion: null,
    previousVersion: null,
    supportTarget: null,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || !value) {
      throw new Error(`unknown or incomplete option: ${option ?? '(missing)'}`);
    }
    if (option === '--evidence') options.evidence = value;
    else if (option === '--artifacts-dir') options.artifactsDir = value;
    else if (option === '--candidate-sha') options.candidateSha = value;
    else if (option === '--candidate-version') options.candidateVersion = value;
    else if (option === '--previous-version') options.previousVersion = value;
    else if (option === '--support-target') options.supportTarget = value;
    else throw new Error(`unknown option: ${option}`);
  }
  for (const [name, value] of Object.entries(options)) {
    if (!value)
      throw new Error(
        `--${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)} is required`
      );
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const evidencePath = path.resolve(options.evidence);
  const report = JSON.parse(readFileSync(evidencePath, 'utf8'));
  await validatePassingRepresentativeInstallEvidence(report, {
    artifactDirectory: path.resolve(options.artifactsDir),
    candidateSha: options.candidateSha,
    candidateVersion: options.candidateVersion,
    previousVersion: options.previousVersion,
    supportTarget: options.supportTarget,
  });
  console.log(
    JSON.stringify({
      outcome: 'passed',
      candidateSha: report.candidateSha,
      platform: report.environment.platform,
      architecture: report.environment.architecture,
      supportTarget: report.environment.supportTarget,
      reviewedAt: report.review.reviewedAt,
    })
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[gate5-evidence-validator] ${error.message}`);
    process.exit(1);
  });
}
