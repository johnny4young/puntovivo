import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SENTRY_DATA_COLLECTION } from './sentry-data-collection.ts';

test('Sentry data collection stays disabled for every category', () => {
  assert.deepEqual(SENTRY_DATA_COLLECTION, {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  });
});
