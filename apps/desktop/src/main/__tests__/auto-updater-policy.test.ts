import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  fetchUpdatePolicy,
  isCandidateAllowedByPolicy,
  parseUpdatePolicy,
  UPDATE_POLICY_URL,
} from '../auto-updater/update-policy.ts';

const NORMAL_POLICY = {
  schemaVersion: 1,
  mode: 'normal',
  targetVersion: '1.6.0',
  rolloutPercentage: 10,
  publishedAt: '2026-07-15T12:00:00.000Z',
} as const;

describe('parseUpdatePolicy', () => {
  it('accepts a strict normal policy and rollback only at 100 percent', () => {
    assert.deepEqual(parseUpdatePolicy(NORMAL_POLICY), NORMAL_POLICY);
    assert.equal(
      parseUpdatePolicy({
        ...NORMAL_POLICY,
        mode: 'rollback',
        targetVersion: '1.5.1',
        rolloutPercentage: 100,
      }).mode,
      'rollback'
    );
  });

  it('rejects unknown fields, malformed versions, invalid percentages, and partial rollback', () => {
    assert.throws(() => parseUpdatePolicy({ ...NORMAL_POLICY, extra: true }), /unexpected shape/);
    assert.throws(
      () => parseUpdatePolicy({ ...NORMAL_POLICY, targetVersion: 'latest' }),
      /must be semantic/
    );
    assert.throws(
      () => parseUpdatePolicy({ ...NORMAL_POLICY, rolloutPercentage: 25 }),
      /10, 50, or 100/
    );
    assert.throws(
      () => parseUpdatePolicy({ ...NORMAL_POLICY, mode: 'rollback' }),
      /must target 100 percent/
    );
    assert.throws(
      () => parseUpdatePolicy({ ...NORMAL_POLICY, publishedAt: 'July 15, 2026 12:00 UTC' }),
      /must be an ISO timestamp/
    );
  });
});

describe('rollback candidate policy', () => {
  it('does not restrict normal updates but pins rollback to the exact target', () => {
    assert.equal(isCandidateAllowedByPolicy(NORMAL_POLICY, '9.0.0'), true);
    const rollback = parseUpdatePolicy({
      ...NORMAL_POLICY,
      mode: 'rollback',
      targetVersion: '1.5.1',
      rolloutPercentage: 100,
    });
    assert.equal(isCandidateAllowedByPolicy(rollback, '1.5.1'), true);
    assert.equal(isCandidateAllowedByPolicy(rollback, '1.4.0'), false);
    assert.equal(isCandidateAllowedByPolicy(null, '1.4.0'), true);
  });
});

describe('fetchUpdatePolicy', () => {
  it('uses the fixed credential-free endpoint and parses the response', async () => {
    const result = await fetchUpdatePolicy({
      fetchImpl: (async (input, init) => {
        const requestUrl = new URL(String(input));
        assert.equal(`${requestUrl.origin}${requestUrl.pathname}`, UPDATE_POLICY_URL);
        assert.equal(requestUrl.searchParams.get('noCache'), '1784117100000');
        assert.deepEqual(init?.headers, { Accept: 'application/json' });
        assert.equal(init?.cache, 'no-store');
        assert.equal(init?.credentials, 'omit');
        assert.equal(init?.redirect, 'error');
        return Response.json(NORMAL_POLICY);
      }) as typeof fetch,
      now: () => new Date('2026-07-15T12:05:00.000Z'),
    });

    assert.deepEqual(result, {
      kind: 'ok',
      policy: NORMAL_POLICY,
      checkedAt: '2026-07-15T12:05:00.000Z',
    });
  });

  it('normalizes HTTP and malformed policy failures without throwing', async () => {
    assert.deepEqual(
      await fetchUpdatePolicy({
        fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
        now: () => new Date('2026-07-15T12:05:00.000Z'),
      }),
      {
        kind: 'error',
        message: 'policy HTTP 503',
        checkedAt: '2026-07-15T12:05:00.000Z',
      }
    );

    const malformed = await fetchUpdatePolicy({
      fetchImpl: (async () => Response.json({ ...NORMAL_POLICY, mode: 'unsafe' })) as typeof fetch,
    });
    assert.equal(malformed.kind, 'error');
    assert.match(
      malformed.kind === 'error' ? malformed.message : '',
      /mode must be normal or rollback/
    );
  });
});
