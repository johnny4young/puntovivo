#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  assertSqliteIntegrity,
  createBackupBundle,
  extractBackupBundle,
  verifyExtractedBundleAuthenticity,
} from '../apps/desktop/src/main/backup/backup-bundle.ts';
import {
  BACKUP_STREAM_PROFILE_PREFIX,
  compareBackupStreamingProfile,
  parseBackupStreamingMeasurement,
  resolveBackupStreamingProfileOptions,
} from './backup-streaming-budget.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MIB = 1024 * 1024;
const ENCRYPTION_KEY = 'b'.repeat(64);
const ROW_BYTES = MIB;

function round(value) {
  return Number(value.toFixed(2));
}

function applySqlCipherKey(db) {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${ENCRYPTION_KEY}'"`);
}

function seedEncryptedProfileDatabase(path, fixtureMiB) {
  const db = new Database(path);
  applySqlCipherKey(db);
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = OFF');
  db.exec('CREATE TABLE profile_payload (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
  const insert = db.prepare('INSERT INTO profile_payload (payload) VALUES (zeroblob(?))');
  const insertAll = db.transaction(() => {
    for (let index = 0; index < fixtureMiB; index += 1) insert.run(ROW_BYTES);
  });
  try {
    insertAll();
  } finally {
    db.close();
  }
}

async function runWorker({ sourceDbPath, workspaceDir, fixtureMiB }) {
  // Warm one tiny end-to-end bundle before taking the growth baseline. The
  // absolute ceiling below still includes cold native/JIT allocation; the
  // growth metric then isolates database-size scaling instead of counting the
  // same one-time SQLCipher/ZIP allocator arenas as if they were payload.
  const warmupDbPath = join(workspaceDir, 'warmup-source.db');
  const warmupZipPath = join(workspaceDir, 'warmup.zip');
  const warmupExtractDir = join(workspaceDir, 'warmup-extracted');
  seedEncryptedProfileDatabase(warmupDbPath, 1);
  const warmupCreated = await createBackupBundle({
    dbPath: warmupDbPath,
    outZipPath: warmupZipPath,
    encryptionKey: ENCRYPTION_KEY,
  });
  const warmupExtracted = await extractBackupBundle(warmupCreated.zipPath, warmupExtractDir);
  await assertSqliteIntegrity(warmupExtracted.dbPath, { encryptionKey: ENCRYPTION_KEY });
  await verifyProfileBundle(warmupExtracted, 1);
  await rm(warmupDbPath, { force: true });
  await rm(warmupZipPath, { force: true });
  await rm(warmupExtractDir, { recursive: true, force: true });
  globalThis.gc?.();
  const baselineRssMiB = process.memoryUsage().rss / MIB;
  const zipPath = join(workspaceDir, 'profile.zip');
  const extractDir = join(workspaceDir, 'extracted');

  const createStarted = performance.now();
  const created = await createBackupBundle({
    dbPath: sourceDbPath,
    outZipPath: zipPath,
    encryptionKey: ENCRYPTION_KEY,
  });
  const createElapsedMs = performance.now() - createStarted;
  const peakAfterCreateMiB = process.resourceUsage().maxRSS / 1024;
  const rssAfterCreateMiB = process.memoryUsage().rss / MIB;

  const extractStarted = performance.now();
  const extracted = await extractBackupBundle(zipPath, extractDir);
  const extractElapsedMs = performance.now() - extractStarted;
  const peakAfterExtractMiB = process.resourceUsage().maxRSS / 1024;

  const verifyStarted = performance.now();
  await assertSqliteIntegrity(extracted.dbPath, { encryptionKey: ENCRYPTION_KEY });
  const peakAfterIntegrityMiB = process.resourceUsage().maxRSS / 1024;
  const verifyPeaks = await verifyProfileBundle(extracted, fixtureMiB);
  const verifyElapsedMs = performance.now() - verifyStarted;
  const peakAfterVerifyMiB = process.resourceUsage().maxRSS / 1024;

  const dbMiB = (await stat(sourceDbPath)).size / MIB;
  const peakRssMiB = process.resourceUsage().maxRSS / 1024;
  return {
    fixtureMiB,
    dbMiB: round(dbMiB),
    zipMiB: round(created.zipBytes / MIB),
    baselineRssMiB: round(baselineRssMiB),
    peakRssMiB: round(peakRssMiB),
    rssGrowthMiB: round(Math.max(0, peakRssMiB - baselineRssMiB)),
    peakAfterCreateMiB: round(peakAfterCreateMiB),
    peakAfterExtractMiB: round(peakAfterExtractMiB),
    peakAfterVerifyMiB: round(peakAfterVerifyMiB),
    peakAfterIntegrityMiB: round(peakAfterIntegrityMiB),
    peakAfterAuthenticityMiB: round(verifyPeaks.peakAfterAuthenticityMiB),
    rssAfterCreateMiB: round(rssAfterCreateMiB),
    createElapsedMs: round(createElapsedMs),
    extractElapsedMs: round(extractElapsedMs),
    verifyElapsedMs: round(verifyElapsedMs),
  };
}

async function verifyProfileBundle(extracted, expectedRows) {
  const authenticity = await verifyExtractedBundleAuthenticity({
    manifest: extracted.manifest,
    dbPath: extracted.dbPath,
    deviceIdPath: extracted.deviceIdPath,
    keyWrapRaw: extracted.keyWrapRaw,
    encryptionKey: ENCRYPTION_KEY,
  });
  if (authenticity.status !== 'verified') {
    throw new Error(`Backup streaming profile authenticity was ${authenticity.status}.`);
  }
  const peakAfterAuthenticityMiB = process.resourceUsage().maxRSS / 1024;
  const verifier = new Database(extracted.dbPath, { readonly: true, fileMustExist: true });
  applySqlCipherKey(verifier);
  const row = verifier.prepare('SELECT count(*) AS count FROM profile_payload').get();
  verifier.close();
  if (row.count !== expectedRows) {
    throw new Error(`Backup streaming profile restored ${row.count} rows, expected ${expectedRows}.`);
  }
  return { peakAfterAuthenticityMiB };
}

async function runWorkerProcess(args) {
  const childArgs = [
    ...process.execArgv,
    SCRIPT_PATH,
    '--worker',
    '--source-db',
    args.sourceDbPath,
    '--workspace',
    args.workspaceDir,
    '--fixture-mib',
    String(args.fixtureMiB),
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PUNTOVIVO_LOG_LEVEL: 'warn',
      PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error(`Backup streaming worker exited ${exitCode}.\n${stderr}\n${stdout}`);
  }
  const measurement = parseBackupStreamingMeasurement(stdout);
  if (!measurement) {
    throw new Error(`Backup streaming worker emitted no valid measurement.\n${stderr}\n${stdout}`);
  }
  return measurement;
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--worker')) {
    const fixtureMiB = Number(valueAfter(argv, '--fixture-mib'));
    const sourceDbPath = valueAfter(argv, '--source-db');
    const workspaceDir = valueAfter(argv, '--workspace');
    if (!Number.isSafeInteger(fixtureMiB) || fixtureMiB <= 0 || !sourceDbPath || !workspaceDir) {
      throw new Error('Backup streaming worker received invalid arguments.');
    }
    const measurement = await runWorker({ sourceDbPath, workspaceDir, fixtureMiB });
    process.stdout.write(`${BACKUP_STREAM_PROFILE_PREFIX}${JSON.stringify(measurement)}\n`);
    return;
  }

  const budget = JSON.parse(await readFile(join(REPO_ROOT, 'perf-budget.json'), 'utf8'));
  const options = resolveBackupStreamingProfileOptions({ argv, budget });
  const workspaceDir = await mkdtemp(join(tmpdir(), 'puntovivo-backup-stream-profile-'));
  try {
    const sourceDbPath = join(workspaceDir, 'source.db');
    seedEncryptedProfileDatabase(sourceDbPath, options.fixtureMiB);
    const measurement = await runWorkerProcess({
      sourceDbPath,
      workspaceDir,
      fixtureMiB: options.fixtureMiB,
    });
    const contract = budget.operationalProfile.encryptedBackup.streamingProfile;
    const regressions = compareBackupStreamingProfile(measurement, contract);
    process.stdout.write(
      `Backup streaming ${regressions.length === 0 ? 'PASS' : 'REGRESSION'} (${options.profile})\n${JSON.stringify(
        { measurement, contract, regressions },
        null,
        2
      )}\n`
    );
    if (options.strict && regressions.length > 0) process.exitCode = 1;
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

await main();
