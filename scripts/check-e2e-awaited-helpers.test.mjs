import assert from 'node:assert/strict';
import test from 'node:test';

import { collectAsyncHelpers, findDroppedPromises } from './check-e2e-awaited-helpers.mjs';

const SUPPORT = {
  path: 'e2e/web/support/app.ts',
  text: `
    export async function expectNoClientIssues(tracker) { await tracker.flush(); }
    export async function login(page) { await page.goto('/'); }
    export function buildTracker() { return {}; }
    async function notExported() {}
  `,
};

const helpers = () => collectAsyncHelpers([SUPPORT]);

test('collects only the exported async helpers', () => {
  assert.deepEqual([...helpers()].sort(), ['expectNoClientIssues', 'login']);
});

test('a bare call statement is reported with its line', () => {
  // The real incident: the spec finishes before the assertion settles, so the
  // journey reports green while the failure surfaces as an unhandled rejection.
  const spec = {
    path: 'e2e/web/thing.spec.ts',
    text: ['test("x", async () => {', '  expectNoClientIssues(tracker);', '});'].join('\n'),
  };
  const found = findDroppedPromises([spec], helpers());
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'expectNoClientIssues');
  assert.equal(found[0].line, 2, 'the reported line must point at the call');
});

test('every way of consuming the promise is accepted', () => {
  const spec = {
    path: 'e2e/web/thing.spec.ts',
    text: `
      test('x', async () => {
        await expectNoClientIssues(tracker);
        const pending = login(page);
        return expectNoClientIssues(other);
      });
      test('y', async () => {
        void expectNoClientIssues(tracker);
        expectNoClientIssues(tracker).catch(() => {});
        await Promise.all([login(page), expectNoClientIssues(tracker)]);
      });
    `,
  };
  assert.deepEqual(findDroppedPromises([spec], helpers()), []);
});

test('a synchronous helper of the same shape is not reported', () => {
  // Only helpers that actually return a promise matter; flagging every bare
  // call would make the gate noise the next author learns to ignore.
  const spec = { path: 'e2e/web/thing.spec.ts', text: 'buildTracker();\n' };
  assert.deepEqual(findDroppedPromises([spec], helpers()), []);
});

test('a method call that merely shares a helper name is not reported', () => {
  const spec = { path: 'e2e/web/thing.spec.ts', text: 'page.login(user);\n' };
  assert.deepEqual(findDroppedPromises([spec], helpers()), []);
});
