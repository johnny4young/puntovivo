#!/usr/bin/env node
/**
 * Convert a local Gate 5 draft into a sanitized, hash-bound manifest.
 *
 * The draft has the same fields as the final report except that `artifacts` is
 * replaced by `artifactFiles`, whose values are basenames in the draft's own
 * directory. No path, screenshot content, database bytes, or operator identity
 * is copied into the manifest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  artifactRecord,
  REPRESENTATIVE_INSTALL_ARTIFACT_KEYS,
  validateRepresentativeInstallEvidenceEnvelope,
  validateRepresentativeInstallArtifactFiles,
} from './lib/representative-install-evidence.mjs';

function assertDraftArtifactFiles(artifactFiles) {
  if (!artifactFiles || typeof artifactFiles !== 'object' || Array.isArray(artifactFiles)) {
    throw new Error('Gate 5 draft artifactFiles must be an object');
  }
  const actual = Object.keys(artifactFiles).sort();
  const expected = [...REPRESENTATIVE_INSTALL_ARTIFACT_KEYS].sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) {
    throw new Error('Gate 5 draft artifactFiles shape is unsupported');
  }
  for (const [key, fileName] of Object.entries(artifactFiles)) {
    if (
      typeof fileName !== 'string' ||
      fileName.length === 0 ||
      path.basename(fileName) !== fileName
    ) {
      throw new Error(`Gate 5 ${key} must be a basename in the draft directory`);
    }
  }
}

export async function collectRepresentativeInstallEvidence(draft, artifactDirectory) {
  const { artifactFiles, ...report } = draft;
  assertDraftArtifactFiles(artifactFiles);
  report.artifacts = {};
  for (const key of REPRESENTATIVE_INSTALL_ARTIFACT_KEYS) {
    report.artifacts[key] = await artifactRecord(path.join(artifactDirectory, artifactFiles[key]));
  }
  validateRepresentativeInstallEvidenceEnvelope(report);
  await validateRepresentativeInstallArtifactFiles(report, artifactDirectory);
  return report;
}

function parseArgs(argv) {
  let input = null;
  let output = null;
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || !value) {
      throw new Error(`unknown or incomplete option: ${option ?? '(missing)'}`);
    }
    if (option === '--input') input = value;
    else if (option === '--output') output = value;
    else throw new Error(`unknown option: ${option}`);
  }
  if (!input) throw new Error('--input is required');
  return { input, output };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(options.input);
  const artifactDirectory = path.dirname(input);
  const output = path.resolve(
    options.output ?? path.join(artifactDirectory, 'gate5-manifest.json')
  );
  const draft = JSON.parse(readFileSync(input, 'utf8'));
  const report = await collectRepresentativeInstallEvidence(draft, artifactDirectory);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      candidateSha: report.candidateSha,
      platform: report.environment.platform,
      supportTarget: report.environment.supportTarget,
      manifest: path.basename(output),
    })
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[gate5-evidence-collector] ${error.message}`);
    process.exit(1);
  });
}
