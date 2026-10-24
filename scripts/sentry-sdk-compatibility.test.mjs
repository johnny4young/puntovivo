/** Real SDK and Lighthouse-owner migration contracts; memory transport only. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const lighthouseRequire = createRequire(require.resolve('lighthouse/package.json'));
const sdk = await import('@sentry/node');
const privateOptions = {
  defaultIntegrations: false,
  enableOpenTelemetrySetup: false,
  enableRuntimeChannelInjection: false,
  traceLifecycle: 'static',
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
    stackFrameVariables: false,
    frameContextLines: 0,
  },
};

function memoryTransport(envelopes) {
  return () => ({
    send: async envelope => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  });
}

function items(envelopes, type) {
  return envelopes
    .flatMap(([, contents]) => contents)
    .filter(([header]) => header.type === type)
    .map(([, payload]) => payload);
}

test('real Node11 SDK retains exception and static-span protocol in owned memory', async () => {
  const envelopes = [];
  sdk.init({
    ...privateOptions,
    dsn: 'https://synthetic@example.invalid/1',
    release: 'synthetic-fixture',
    tracesSampleRate: 1,
    transport: memoryTransport(envelopes),
  });
  try {
    sdk.captureException(new Error('synthetic-migration-error'), {
      extra: { fixture: 'synthetic' },
    });
    const span = sdk.startInactiveSpan({
      name: 'synthetic-completed-operation',
      op: 'puntovivo.span',
      startTime: new Date(Date.now() - 100),
      attributes: { outcome: 'ok', count: 2 },
    });
    span.setStatus({ code: 1 });
    span.end(new Date());
    assert.equal(await sdk.flush(2000), true);
    const errors = items(envelopes, 'event');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].exception.values[0].value, 'synthetic-migration-error');
    assert.equal(errors[0].extra.fixture, 'synthetic');
    assert.equal(errors[0].release, 'synthetic-fixture');
    const transactions = items(envelopes, 'transaction');
    assert.equal(transactions.length, 1, 'GlitchTip-compatible static transaction is retained');
    assert.equal(transactions[0].transaction, 'synthetic-completed-operation');
    assert.equal(transactions[0].contexts.trace.status, 'ok');
    assert.equal(transactions[0].contexts.trace.data.count, 2);
    assert.equal(items(envelopes, 'span').length, 0, 'no new streamed-span protocol');
    assert.equal(sdk.getClient().getOptions().dataCollection.userInfo, false);
    assert.equal(sdk.getClient().getOptions().dataCollection.httpHeaders, false);
  } finally {
    await sdk.close(2000);
  }
});

test('real Lighthouse error-reporting owner works with Node11 without legacy OTel', async () => {
  assert.equal(lighthouseRequire('@sentry/node/package.json').version, '11.9.0');
  const { Sentry: owner } = await import('lighthouse/core/lib/sentry.js');
  const sample = owner._shouldSample;
  owner._shouldSample = () => true;
  const envelopes = [];
  try {
    await owner.init({
      url: 'https://synthetic.example.invalid/',
      flags: { enableErrorReporting: true },
      environmentData: {
        ...privateOptions,
        transport: memoryTransport(envelopes),
      },
    });
    owner.captureBreadcrumb({ message: 'synthetic-owner-path' });
    await owner.captureException(new Error('synthetic-owner-error'), {
      tags: { audit: 'synthetic-audit' },
      extra: { fixture: true },
      level: 'error',
    });
    assert.equal(await sdk.flush(2000), true);
    const errors = items(envelopes, 'event');
    assert.equal(errors.length, 1, 'owner must not swallow an incompatible API');
    assert.equal(errors[0].exception.values[0].value, 'synthetic-owner-error');
    assert.equal(errors[0].tags.audit, 'synthetic-audit');
    assert.equal(errors[0].extra.fixture, true);
    assert.equal(owner.getContext().url, 'https://synthetic.example.invalid/');
  } finally {
    owner._shouldSample = sample;
    await sdk.close(2000);
  }
});

test('Lighthouse reporting remains disabled in the repository runner', async () => {
  const source = readFileSync(new URL('./check-lighthouse.mjs', import.meta.url), 'utf8');
  assert.match(source, /enableErrorReporting: false/);
  const ownerFile = lighthouseRequire.resolve('lighthouse/core/lib/sentry.js');
  const { Sentry: owner } = await import(pathToFileURL(ownerFile).href + '?synthetic-disabled');
  const previous = sdk.getClient();
  await owner.init({
    url: 'https://synthetic.example.invalid/',
    flags: { enableErrorReporting: false },
  });
  assert.equal(sdk.getClient(), previous);
  assert.equal(await owner.captureException(new Error('synthetic-disabled')), undefined);
});
