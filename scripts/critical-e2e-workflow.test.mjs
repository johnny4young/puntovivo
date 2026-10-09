import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertWebE2eEnvCanUsePlaintextFixture } from './web-e2e-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractJob(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `Expected workflow job ${jobName}`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-zA-Z0-9_-]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

test('critical command selects the bounded tagged contract serially', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const contract = JSON.parse(readRepoFile('operator-journeys.json'));
  const command = packageJson.scripts['test:e2e:web:critical'];

  assert.equal(typeof command, 'string');
  assert.match(command, /--grep @critical/);
  assert.match(command, /--workers=1/);
  assert.match(command, /--forbid-only/);
  assert.doesNotMatch(command, /--grep-invert/);
  const build = command.indexOf('pnpm --filter @puntovivo/server run build');
  assert.notEqual(build, -1, 'critical E2E must build the server imported by global setup');
  assert.ok(build < command.indexOf('playwright test'), 'the build must precede Playwright');
  assert.deepEqual(contract.criticalE2E.requiredAreas, ['sell', 'control', 'close', 'stock']);
  assert.equal(contract.criticalE2E.journeyIds.length, 4);
});

test('web CI runs only the critical subset and retains failure diagnostics', () => {
  const workflow = readRepoFile('.github/workflows/ci.yml');
  const webJob = extractJob(workflow, 'web');

  assert.match(webJob, /run: pnpm run test:e2e:web:critical/);
  assert.doesNotMatch(webJob, /run: pnpm run test:e2e:web\s*$/m);
  assert.match(webJob, /if: \$\{\{ failure\(\) \}\}/);
  assert.match(webJob, /test-results\/playwright-web/);
  assert.match(webJob, /playwright-report\/web/);
});

test('web path filtering includes the executable critical contract', () => {
  const workflow = readRepoFile('.github/workflows/ci.yml');

  assert.match(workflow, /^              - 'e2e\/web\/\*\*'$/m);
  assert.match(workflow, /^              - 'operator-journeys\.json'$/m);
  assert.match(workflow, /^              - 'playwright\.web\.config\.ts'$/m);
  assert.match(workflow, /^              - 'scripts\/web-e2e-env\.mjs'$/m);
  assert.match(workflow, /^              - 'scripts\/check-operator-journeys\*\.mjs'$/m);
});

test('web E2E owns its servers and never borrows another worktree on the dev port', () => {
  const config = readRepoFile('playwright.web.config.ts');

  assert.match(config, /baseURL: webOrigin/);
  assert.match(config, /const webOrigin = resolveE2eWebOrigin\(apiOrigin\)/);
  assert.match(config, /--host \$\{webHost\} --port 5173 --strictPort/);
  assert.equal((config.match(/reuseExistingServer: false/g) ?? []).length, 2);
  assert.doesNotMatch(config, /dev-launcher\.mjs/);
  // A watcher outlives an EADDRINUSE exit, letting the health probe reach a
  // foreign listener; the owned backend must exit so Playwright fails closed.
  assert.match(config, /command: 'pnpm --filter @puntovivo\/server run dev:once'/);
  const serverPackage = JSON.parse(readRepoFile('packages/server/package.json'));
  assert.match(serverPackage.scripts['dev:once'], /tsx src\/standalone-development\.ts$/);
  assert.doesNotMatch(serverPackage.scripts['dev:once'], /\bwatch\b/);
  assert.match(config, /DATABASE_URL: e2eDbPath/);
  assert.match(config, /PUNTOVIVO_AUTHORITY_MODE: 'device_local'/);
  assert.match(config, /PUNTOVIVO_BIND_HOST: '127\.0\.0\.1'/);
  assert.match(config, /NODE_ENV: 'development'/);
  assert.match(config, /PUNTOVIVO_RUNTIME_ENV: 'development'/);
  assert.match(config, /delete process\.env\.PUNTOVIVO_DB_KEY/);
  assert.match(config, /assertWebE2eEnvCanUsePlaintextFixture\(process\.cwd\(\)\)/);
});

test('both owned Web E2E services reject inherited production runtime markers', () => {
  const configUrl = pathToFileURL(path.join(repoRoot, 'playwright.web.config.ts')).href;
  const program = [
    `import config from ${JSON.stringify(configUrl)};`,
    'console.log(JSON.stringify(config.webServer.map(({ env }) => ({',
    '  NODE_ENV: env.NODE_ENV, PUNTOVIVO_RUNTIME_ENV: env.PUNTOVIVO_RUNTIME_ENV',
    '}))));',
  ].join('\n');
  const output = execFileSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--input-type=module',
      '-e',
      program,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: 'production', PUNTOVIVO_RUNTIME_ENV: 'production' },
      encoding: 'utf8',
    }
  );
  const services = JSON.parse(output);
  assert.deepEqual(services, [
    { NODE_ENV: 'development', PUNTOVIVO_RUNTIME_ENV: 'development' },
    { NODE_ENV: 'development', PUNTOVIVO_RUNTIME_ENV: 'development' },
  ]);
});

test('the isolated origin override addresses every owned backend consumer consistently', () => {
  const configUrl = pathToFileURL(path.join(repoRoot, 'playwright.web.config.ts')).href;
  const program = [
    `import config from ${JSON.stringify(configUrl)};`,
    'console.log(JSON.stringify({',
    '  bind: config.webServer[0].env.PUNTOVIVO_BIND_PORT,',
    '  health: config.webServer[0].url,',
    '  renderer: config.webServer[1].env.VITE_API_URL,',
    '  probes: process.env.PUNTOVIVO_E2E_API_ORIGIN,',
    '}));',
  ].join('\n');
  const args = [
    '--experimental-strip-types',
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--input-type=module',
    '-e',
    program,
  ];
  const env = { ...process.env, PUNTOVIVO_E2E_API_ORIGIN: 'http://localhost:18091' };
  const result = JSON.parse(
    execFileSync(process.execPath, args, { cwd: repoRoot, env, encoding: 'utf8' })
  );
  assert.deepEqual(result, {
    bind: '18091',
    health: 'http://127.0.0.1:18091/api/health',
    renderer: 'http://localhost:18091',
    probes: 'http://localhost:18091',
  });
  assert.throws(
    () =>
      execFileSync(process.execPath, args, {
        cwd: repoRoot,
        env: { ...env, PUNTOVIVO_E2E_API_ORIGIN: 'http://example.com:18091' },
        stdio: 'pipe',
      }),
    /E2E API origin must be an HTTP loopback origin/
  );
});

test('web E2E rejects a local env key before boot without revealing its value', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'puntovivo-web-e2e-env-'));
  const serverDir = path.join(root, 'packages/server');
  mkdirSync(serverDir, { recursive: true });
  try {
    writeFileSync(path.join(root, '.env'), 'PUNTOVIVO_DB_KEY=synthetic-secret\n');
    assert.throws(
      () => assertWebE2eEnvCanUsePlaintextFixture(root),
      error =>
        error instanceof Error &&
        /PUNTOVIVO_DB_KEY/.test(error.message) &&
        !error.message.includes('synthetic-secret')
    );

    // The server loader checks workspace .env first and stops at the first
    // readable file. A workspace-local file without a key shadows root .env.
    writeFileSync(path.join(serverDir, '.env'), 'PUNTOVIVO_E2E=1\n');
    assert.doesNotThrow(() => assertWebE2eEnvCanUsePlaintextFixture(root));
    writeFileSync(path.join(serverDir, '.env'), 'PUNTOVIVO_DB_KEY=another-synthetic-secret\n');
    assert.throws(() => assertWebE2eEnvCanUsePlaintextFixture(root), /PUNTOVIVO_DB_KEY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the ordinary local web suite builds the server its empty-installation fixture imports', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const command = packageJson.scripts['test:e2e:web'];
  const fixture = readRepoFile('e2e/shared/installation-server.mjs');

  // Without this build a fresh checkout fails both first-owner journeys before
  // any browser step, and a stale dist silently exercises an old server.
  assert.match(fixture, /packages\/server\/dist\/index\.js/);
  const build = command.indexOf('pnpm --filter @puntovivo/server run build');
  assert.notEqual(build, -1, 'test:e2e:web must build the server');
  assert.ok(build < command.indexOf('playwright test'), 'the build must precede Playwright');
});

for (const host of ['localhost', '127.0.0.1']) {
  test(`owned Web origin preserves strict refresh cookies with the ${host} API`, () => {
    const configUrl = pathToFileURL(path.join(repoRoot, 'playwright.web.config.ts')).href;
    const program = [
      `import config from ${JSON.stringify(configUrl)};`,
      'console.log(JSON.stringify({ base: config.use.baseURL, web: config.webServer[1].url,',
      'command: config.webServer[1].command, api: config.webServer[1].env.VITE_API_URL }));',
    ].join('\n');
    const output = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '--input-type=module',
        '-e',
        program,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, PUNTOVIVO_E2E_API_ORIGIN: `http://${host}:18091` },
        encoding: 'utf8',
      }
    );
    const config = JSON.parse(output);
    assert.equal(config.base, `http://${host}:5173`);
    assert.equal(config.web, `http://${host}:5173/login`);
    assert.equal(config.api, `http://${host}:18091`);
    assert.ok(config.command.includes(`--host ${host} --port 5173 --strictPort`));
    assert.equal(new URL(config.base).hostname, new URL(config.api).hostname);
  });
}
