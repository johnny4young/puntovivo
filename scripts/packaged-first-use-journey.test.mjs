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
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  CREDENTIAL_BANNER,
  claimInstallation,
  createSmokeOwnerCredentials,
  signBackIn,
} from './lib/packaged-first-use-journey.mjs';

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

test('the packaged smoke uses the claim journey and never scrapes a credential', () => {
  const source = readFileSync(new URL('./run-desktop-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/lib\/packaged-first-use-journey\.mjs'/);
  assert.match(source, /claimInstallation\(/);
  assert.match(source, /signBackIn\(/);
  assert.match(source, /CREDENTIAL_BANNER\.test\(/, 'a printed credential must fail the smoke');
  assert.doesNotMatch(source, /Password:\\s\+\(/, 'the smoke must not read a password from output');
  assert.doesNotMatch(source, /waitForFirstRunPassword/);
});
