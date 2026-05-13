/**
 * ENG-040d — 10-invoice OCR accuracy benchmark.
 *
 * Operator-runnable. NOT wired into CI (real OpenAI vision call per
 * fixture; consumes the tenant's `monthlyBudgetUsd`).
 *
 *   OPENAI_API_KEY=sk-... npm run benchmark:invoice-ocr --workspace=@puntovivo/server
 *
 * The harness boots an in-memory SQLite, seeds one tenant with AI
 * enabled + OpenAI provider, then walks every NN-<slug>.png in
 * `__fixtures__/invoice-ocr/`, calls `extractInvoiceFromImage`, and
 * scores against the matching NN-<slug>.json ground truth. Aggregate
 * accuracy ≥ 0.80 exits 0; otherwise exits 1.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../src/index.js';
import type { DatabaseInstance } from '../src/db/index.js';
import { tenants } from '../src/db/schema.js';
import { extractInvoiceFromImage } from '../src/services/ai/vision/invoice-ocr.js';
import {
  aggregateBenchmark,
  scoreFixture,
  type FixtureGroundTruth,
  type FixtureScore,
} from '../src/services/ai/vision/benchmark-scoring.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', '__fixtures__', 'invoice-ocr');

const TENANT_ID = 'benchmark-tenant';
const TENANT_BUDGET_USD = 25;

interface RunArgs {
  threshold: number;
  modelId: string | null;
}

function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = { threshold: 0.8, modelId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold' && argv[i + 1]) {
      const next = argv[i + 1];
      if (next === undefined) continue;
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error(`--threshold must be a number in [0,1], got "${next}"`);
      }
      args.threshold = n;
      i++;
    } else if (a === '--model' && argv[i + 1]) {
      const next = argv[i + 1];
      if (next === undefined) continue;
      args.modelId = next;
      i++;
    }
  }
  return args;
}

interface FixturePair {
  id: string;
  pngPath: string;
  truth: FixtureGroundTruth;
}

function loadFixtures(): FixturePair[] {
  const entries = readdirSync(fixturesDir).sort();
  const pngs = entries.filter((e) => extname(e) === '.png');
  if (pngs.length === 0) {
    throw new Error(
      `No PNG fixtures under ${fixturesDir}. Run generate-invoice-ocr-fixtures.mjs first.`,
    );
  }
  return pngs.map((png) => {
    const id = basename(png, '.png');
    const truthPath = join(fixturesDir, `${id}.json`);
    const truthRaw = readFileSync(truthPath, 'utf8');
    const truth = JSON.parse(truthRaw) as FixtureGroundTruth;
    if (!Array.isArray(truth.lines)) {
      throw new Error(`Truth file ${truthPath} has no .lines array`);
    }
    return { id, pngPath: join(fixturesDir, png), truth };
  });
}

async function configureTenantForOpenAI(
  db: DatabaseInstance,
  modelId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: TENANT_ID,
    name: 'Benchmark Tenant',
    slug: 'benchmark-tenant',
    settings: {
      ai: {
        enabled: true,
        providerId: 'openai',
        modelId,
        monthlyBudgetUsd: TENANT_BUDGET_USD,
      },
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

function formatTable(scores: FixtureScore[]): string {
  const headers = ['Fixture', 'Matched', 'Truth', 'Accuracy', 'Cost USD', 'Duration'];
  const rows = scores.map((s) => [
    s.fixtureId,
    String(s.matchedLines),
    String(s.truthLines),
    `${(s.accuracy * 100).toFixed(1)}%`,
    `$${s.costUsd.toFixed(4)}`,
    `${s.durationMs}ms`,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const formatRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join('  ');
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  return [formatRow(headers), separator, ...rows.map(formatRow)].join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY must be set to run the live benchmark.');
    console.error('  export OPENAI_API_KEY=sk-... && npm run benchmark:invoice-ocr');
    process.exit(2);
  }

  const fixtures = loadFixtures();
  console.log(`Loaded ${fixtures.length} fixtures from ${fixturesDir}\n`);

  const server = await createServer({ dbPath: ':memory:', verbose: false });
  try {
    await configureTenantForOpenAI(server.db, args.modelId);

    const scores: FixtureScore[] = [];
    for (const fixture of fixtures) {
      const pngBytes = readFileSync(fixture.pngPath);
      const imageBase64 = pngBytes.toString('base64');
      const started = Date.now();
      try {
        const result = await extractInvoiceFromImage(
          {
            db: server.db,
            tenantId: TENANT_ID,
            siteId: null,
            userId: null,
          },
          { imageBase64, mimeType: 'image/png' },
        );
        const { matchedLines, truthLines } = scoreFixture(fixture.truth, result.invoice);
        scores.push({
          fixtureId: fixture.id,
          truthLines,
          matchedLines,
          accuracy: truthLines === 0 ? 1 : matchedLines / truthLines,
          costUsd: result.costUsd,
          durationMs: result.durationMs,
        });
        console.log(
          `  ${fixture.id}: ${matchedLines}/${truthLines} (${
            truthLines === 0 ? 'N/A' : ((matchedLines / truthLines) * 100).toFixed(1) + '%'
          }) cost=$${result.costUsd.toFixed(4)} ${result.durationMs}ms`,
        );
      } catch (error) {
        const elapsed = Date.now() - started;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ${fixture.id}: FAILED in ${elapsed}ms — ${message}`);
        scores.push({
          fixtureId: fixture.id,
          truthLines: fixture.truth.lines.length,
          matchedLines: 0,
          accuracy: 0,
          costUsd: 0,
          durationMs: elapsed,
        });
      }
    }

    console.log('\n' + formatTable(scores));

    const aggregate = aggregateBenchmark(scores, args.threshold);
    console.log(
      `\nAggregate: ${aggregate.matched}/${aggregate.total} lines matched ` +
        `(${(aggregate.accuracy * 100).toFixed(2)}%) ` +
        `vs threshold ${(aggregate.threshold * 100).toFixed(0)}% — ` +
        `${aggregate.passed ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `Total cost: $${aggregate.costUsd.toFixed(4)} over ${aggregate.durationMs}ms`,
    );

    process.exitCode = aggregate.passed ? 0 : 1;
  } finally {
    await server.app.close().catch(() => {});
  }
}

await main();
