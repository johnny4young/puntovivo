/** The negative pharmacy journey must not hide unrelated client diagnostics. */
import { expect, test } from '@playwright/test';
import { expectOnlyVerifiedPharmacyRejections } from '../shared/pharmacy-rejection-assertions.js';

const rejection = { url: 'http://localhost/api/trpc/sales.create?batch=1', status: 409 as const };
const response = `response:409 ${rejection.url}`;
const consoleLine =
  'console:Failed to load resource: the server responded with a status of 409 (Conflict)';

test('negative journey accepts only its verified response and optional single browser diagnostic', () => {
  expect(() =>
    expectOnlyVerifiedPharmacyRejections({ getIssues: () => [response] }, [rejection])
  ).not.toThrow();
  expect(() =>
    expectOnlyVerifiedPharmacyRejections({ getIssues: () => [consoleLine, response] }, [rejection])
  ).not.toThrow();
});

for (const additional of [
  'response:409 http://localhost/api/trpc/products.update?batch=1',
  'response:500 http://localhost/api/trpc/sales.create?batch=1',
  'pageerror:TypeError: unexpected renderer failure',
  'requestfailed:net::ERR_FAILED http://localhost/api/trpc/pharmacy.context',
  'console:unexpected application error',
  consoleLine,
]) {
  test(`negative journey rejects an additional diagnostic: ${additional}`, () => {
    expect(() =>
      expectOnlyVerifiedPharmacyRejections(
        {
          getIssues: () => [response, consoleLine, additional],
        },
        [rejection]
      )
    ).toThrow();
  });
}

test('negative journey rejects a missing response and an unverified status', () => {
  expect(() =>
    expectOnlyVerifiedPharmacyRejections({ getIssues: () => [] }, [rejection])
  ).toThrow();
  expect(() =>
    expectOnlyVerifiedPharmacyRejections(
      {
        getIssues: () => [
          response,
          'console:Failed to load resource: the server responded with a status of 412 (Precondition Failed)',
        ],
      },
      [rejection]
    )
  ).toThrow();
});
