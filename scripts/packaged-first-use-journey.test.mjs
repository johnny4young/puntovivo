/**
 * The packaged desktop smoke proves first use the way an operator performs it.
 *
 * A packaged install no longer seeds an administrator whose password is
 * printed to stdout, so the smoke can no longer scrape a credential from
 * process output. It must choose its own owner credentials, complete the
 * installation claim through the packaged renderer (where main injects the
 * one-use setup capability), sign out, and sign back in with those same
 * credentials. These tests pin that journey against a recorded page, and pin
 * that the smoke script really uses it.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  CREDENTIAL_BANNER,
  claimInstallation,
  createSmokeOwnerCredentials,
  settleRenderer,
  signBackIn,
  trackRendererRequests,
} from './lib/packaged-first-use-journey.mjs';

/**
 * A Playwright page stand-in for settling: it emits request events the way
 * connectOverCDP delivers them, and runs the animation probe in Node against a
 * controllable document.getAnimations.
 */
function settlePage({ animatingForMs = 0 } = {}) {
  const started = performance.now();
  const listeners = new Map();
  return {
    started,
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    emit(event, request) {
      for (const handler of listeners.get(event) ?? []) handler(request);
    },
    async evaluate(probe) {
      globalThis.document = {
        getAnimations: () =>
          performance.now() - started < animatingForMs ? [{ playState: 'running' }] : [],
      };
      try {
        return probe();
      } finally {
        delete globalThis.document;
      }
    },
  };
}

function pageRequest(url, resourceType = 'fetch') {
  return { url: () => url, resourceType: () => resourceType };
}

/** A Playwright page stand-in that records every operator action in order. */
function recordedPage({ tokenFieldCount = 0 } = {}) {
  const actions = [];
  const clicker = target => ({
    click: async () => {
      actions.push(['click', target]);
    },
  });
  const locator = selector => ({
    waitFor: async () => {
      actions.push(['wait', selector]);
    },
    fill: async value => {
      actions.push(['fill', selector, value]);
    },
    selectOption: async value => {
      actions.push(['select', selector, value]);
    },
    count: async () => (selector === '#setup-token' ? tokenFieldCount : 1),
    getByRole: (role, { name }) => clicker(`${selector} ${role} ${name.source}`),
  });
  return {
    actions,
    locator,
    getByRole: (role, { name }) => clicker(`${role} ${name.source}`),
    waitForFunction: async () => {
      actions.push(['workspace']);
    },
    url: () => 'puntovivo-app://app/index.html#/company',
  };
}

function indexOf(actions, predicate) {
  const index = actions.findIndex(predicate);
  assert.notEqual(index, -1, 'expected action was never performed');
  return index;
}

test('chooses owner credentials that satisfy the password policy, fresh on every run', () => {
  const first = createSmokeOwnerCredentials();
  const second = createSmokeOwnerCredentials();
  for (const { email, password } of [first, second]) {
    assert.match(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    assert.ok(password.length >= 12);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
  }
  assert.notEqual(first.email, second.email);
  assert.notEqual(first.password, second.password);
});

test('claims the installation through both setup steps with the chosen owner', async () => {
  const page = recordedPage();
  const credentials = { email: 'owner@example.com', password: 'Chosen-Password-1' };
  await claimInstallation(page, credentials, { timeoutMs: 1_000 });
  const { actions } = page;

  const business = indexOf(
    actions,
    ([kind, target]) => kind === 'fill' && target === '#setup-businessName'
  );
  const country = indexOf(
    actions,
    ([kind, target, value]) =>
      kind === 'select' && target === '#setup-countryCode' && value === 'CO'
  );
  const next = indexOf(actions, ([kind, target]) => kind === 'click' && /Continue/.test(target));
  const email = indexOf(
    actions,
    ([kind, target, value]) =>
      kind === 'fill' && target === '#setup-email' && value === credentials.email
  );
  const confirm = indexOf(
    actions,
    ([kind, target, value]) =>
      kind === 'fill' && target === '#setup-confirmPassword' && value === credentials.password
  );
  const create = indexOf(
    actions,
    ([kind, target]) => kind === 'click' && /Create my workspace/.test(target)
  );

  assert.ok(business < country && country < next, 'business step completes before continuing');
  assert.ok(
    next < email && email < confirm && confirm < create,
    'owner step completes before submitting'
  );
  assert.deepEqual(actions.at(-1), ['workspace'], 'the claim must land in the workspace');
  assert.ok(
    actions.some(
      ([kind, target, value]) =>
        kind === 'fill' && target === '#setup-password' && value === credentials.password
    )
  );
});

test('refuses a packaged renderer that asks for the setup token', async () => {
  // The native claim lets main supply the one-use capability. A visible token
  // field means the preload bridge did not provide it.
  const page = recordedPage({ tokenFieldCount: 1 });
  await assert.rejects(
    claimInstallation(page, createSmokeOwnerCredentials(), { timeoutMs: 1_000 }),
    /setup token/
  );
  assert.equal(
    page.actions.some(([kind, target]) => kind === 'click' && /Create my workspace/.test(target)),
    false
  );
});

test('signs out and signs back in with the same claimed credentials', async () => {
  const page = recordedPage();
  const credentials = { email: 'owner@example.com', password: 'Chosen-Password-1' };
  await signBackIn(page, credentials, { timeoutMs: 1_000 });
  const { actions } = page;

  const menu = indexOf(
    actions,
    ([kind, target]) => kind === 'click' && /^header button .*user menu/.test(target)
  );
  const signOut = indexOf(actions, ([kind, target]) => kind === 'click' && /Sign out/.test(target));
  const email = indexOf(
    actions,
    ([kind, target, value]) => kind === 'fill' && target === '#email' && value === credentials.email
  );
  const password = indexOf(
    actions,
    ([kind, target, value]) =>
      kind === 'fill' && target === '#password' && value === credentials.password
  );
  const enter = indexOf(
    actions,
    ([kind, target]) => kind === 'click' && /enter workspace/.test(target)
  );

  assert.ok(menu < signOut && signOut < email && email < password && password < enter);
  assert.deepEqual(actions.at(-1), ['workspace']);
});

test('recognises every credential a packaged first run must never print', () => {
  // Guards the guard: the smoke fails on this pattern, so it must still match
  // the exact lines the seeded administrator and a standalone server print.
  assert.match('[Database] Password: 3f9c0a1b', CREDENTIAL_BANNER);
  assert.match('  Installation code: 9f86d081884c7d65', CREDENTIAL_BANNER);
  assert.doesNotMatch('[Database] Encrypted database opened', CREDENTIAL_BANNER);
  assert.doesNotMatch('[Server] ✓ Server started at http://127.0.0.1:8090', CREDENTIAL_BANNER);
});

test('settles only after animations stop and requests finish', async () => {
  const page = settlePage({ animatingForMs: 120 });
  const requests = trackRendererRequests(page);
  const data = pageRequest('http://127.0.0.1:37707/api/trpc/sales.list?batch=1');
  page.emit('request', data);
  setTimeout(() => page.emit('requestfinished', data), 200);

  await settleRenderer(page, requests, { quietMs: 100, timeoutMs: 2_000 });
  const elapsed = performance.now() - page.started;
  // The quiet window starts after the last activity: the request at 200 ms.
  assert.ok(elapsed >= 300, `settled after ${elapsed.toFixed(0)} ms, before activity stopped`);
});

test('refuses to shut down over a renderer that never stops animating', async () => {
  const page = settlePage({ animatingForMs: Number.POSITIVE_INFINITY });
  await assert.rejects(
    settleRenderer(page, trackRendererRequests(page), { quietMs: 100, timeoutMs: 300 }),
    /still animating or loading 300 ms after its landing/
  );
});

test('waits for a request that is still in flight past the quiet window', async () => {
  // Resource timing only reports a request once it completes; a request that
  // starts before settling and outlives the quiet window must still hold it.
  const page = settlePage();
  const requests = trackRendererRequests(page);
  const slow = pageRequest('http://127.0.0.1:37707/api/trpc/setupReadiness.get?batch=1');
  page.emit('request', slow);
  setTimeout(() => page.emit('requestfinished', slow), 400);

  await settleRenderer(page, requests, { quietMs: 100, timeoutMs: 2_000 });
  const elapsed = performance.now() - page.started;
  assert.ok(elapsed >= 500, `settled after ${elapsed.toFixed(0)} ms while a request was in flight`);
});

test('ignores the streams that stay open for the whole session', async () => {
  // The realtime channel is a streaming fetch that never finishes, so counting
  // it would hold every landing that subscribes until the timeout.
  const page = settlePage();
  const requests = trackRendererRequests(page);
  page.emit(
    'request',
    pageRequest('http://127.0.0.1:37707/api/realtime/subscribe?collections=sales')
  );
  page.emit('request', pageRequest('http://127.0.0.1:37707/events', 'eventsource'));

  await settleRenderer(page, requests, { quietMs: 100, timeoutMs: 1_000 });
  assert.equal(requests.outstanding, 0);
});

test('fails loudly when an ordinary request never finishes', async () => {
  const page = settlePage();
  const requests = trackRendererRequests(page);
  page.emit('request', pageRequest('http://127.0.0.1:37707/api/trpc/reports.dayClose.preview'));
  await assert.rejects(
    settleRenderer(page, requests, { quietMs: 100, timeoutMs: 300 }),
    /\(1 request\(s\) outstanding\)/
  );
});
