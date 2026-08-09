/** Capture a non-identifying local JSON-vs-PVEC benchmark report. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';

import { runVectorStorageBenchmark } from '../perf/vector-storage-benchmark.js';

function outputPath(): string | null {
  const argument = process.argv.slice(2).find(value => value.startsWith('--output='));
  return argument ? resolve(process.cwd(), argument.slice('--output='.length)) : null;
}

const report = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  host: {
    runnerClass: process.env.CI ? 'ci' : 'local',
    os: `${platform()} ${release()}`,
    arch: process.arch,
    node: process.version,
    logicalCpuCount: cpus().length,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    totalMemoryGb: Number((totalmem() / 1024 ** 3).toFixed(2)),
    freeMemoryGbAtStart: Number((freemem() / 1024 ** 3).toFixed(2)),
  },
  benchmark: runVectorStorageBenchmark({
    dimensions: [384, 768, 1024, 1536, 3072, 4096],
    candidateCount: 200,
    topK: 10,
    warmupIterations: 5,
    samples: 30,
    seed: 0x5eed2026,
  }),
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
const destination = outputPath();
if (destination) {
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, serialized, 'utf8');
  process.stdout.write(`vector-storage-benchmark wrote ${destination}\n`);
}
process.stdout.write(serialized);
