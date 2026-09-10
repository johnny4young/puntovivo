import { expect, type Page } from '@playwright/test';
import type { ClientIssueTracker } from '../web/support/app.js';

/** A real rejected operator command whose HTTP and typed business error were asserted. */
export interface VerifiedPharmacyRejection {
  url: string;
  status: 409 | 412;
}

/** Expected business rejection, not a blanket exemption for unsuccessful requests. */
export async function expectPharmacyCommandRejected(
  page: Page,
  input: {
    procedure: 'sales.create' | 'pharmacy.approveEvidence';
    errorCode: 'LOT_STOCK_INCONSISTENT' | 'PHARMACY_EVIDENCE_EXPIRED';
    status: VerifiedPharmacyRejection['status'];
    act: () => Promise<unknown>;
  }
): Promise<VerifiedPharmacyRejection> {
  const responsePromise = page.waitForResponse(
    response =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/trpc/${input.procedure}`
  );
  await input.act();
  const response = await responsePromise;
  expect(response.status()).toBe(input.status);
  const payload: unknown = await response.json();
  expect(payload).toEqual([
    expect.objectContaining({
      error: expect.objectContaining({
        data: expect.objectContaining({ errorCode: input.errorCode }),
      }),
    }),
  ]);
  return { url: response.url(), status: input.status };
}

/**
 * Every failed response must be one already proven above. Chromium can also
 * emit one generic console line for that HTTP status; no page error, failed
 * request, extra response or additional console diagnostic is excused.
 */
export function expectOnlyVerifiedPharmacyRejections(
  tracker: ClientIssueTracker,
  rejections: VerifiedPharmacyRejection[]
) {
  const issues = tracker.getIssues();
  expect(issues.filter(issue => issue.startsWith('response:')).sort()).toEqual(
    rejections.map(rejection => `response:${rejection.status} ${rejection.url}`).sort()
  );
  const remainingConsoleCounts = new Map<number, number>();
  for (const rejection of rejections) {
    remainingConsoleCounts.set(
      rejection.status,
      (remainingConsoleCounts.get(rejection.status) ?? 0) + 1
    );
  }
  const unexpected = issues.filter(issue => {
    if (issue.startsWith('response:')) return false;
    const status =
      /^console:Failed to load resource: the server responded with a status of (409|412) \([^\n]*\)$/.exec(
        issue
      )?.[1];
    if (!status) return true;
    const remaining = remainingConsoleCounts.get(Number(status)) ?? 0;
    if (remaining === 0) return true;
    remainingConsoleCounts.set(Number(status), remaining - 1);
    return false;
  });
  expect(unexpected).toEqual([]);
}
