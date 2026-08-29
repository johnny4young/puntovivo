import { expect, type Page, type Request } from '@playwright/test';

export type MeasuredTask =
  'complete_sale' | 'create_product' | 'close_day' | 'receive_stock' | 'recover_operation';

export interface BrowserTaskMeasurement {
  task: MeasuredTask;
  route: string;
  outcome: 'success' | 'abandoned' | 'failed';
  recoveryOutcome: 'not_needed' | 'succeeded' | 'failed' | 'abandoned';
  durationMs: number;
  timeToFirstUsableControlMs: number | null;
  backtrackCount: number;
  validationErrorCount: number;
  recoveryAttemptCount: number;
  interactionCount: number;
}

const TASK_REPORT_PROCEDURE = 'observability.reportTaskMeasurement';

function isTaskMeasurement(value: unknown): value is BrowserTaskMeasurement {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.task === 'string' &&
    typeof candidate.route === 'string' &&
    typeof candidate.outcome === 'string' &&
    typeof candidate.durationMs === 'number' &&
    typeof candidate.backtrackCount === 'number' &&
    typeof candidate.validationErrorCount === 'number'
  );
}

function collectMeasurements(value: unknown, destination: BrowserTaskMeasurement[]): void {
  if (isTaskMeasurement(value)) {
    destination.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMeasurements(item, destination);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectMeasurements(item, destination);
  }
}

/**
 * Captures the privacy-safe payload at the real browser transport boundary.
 * This remains deterministic even when the tenant has telemetry disabled:
 * consent controls server persistence, while the journey still proves the
 * page emitted a structurally complete aggregate after the real UI action.
 */
export function attachTaskMeasurementTracker(page: Page) {
  const reports: BrowserTaskMeasurement[] = [];
  const onRequest = (request: Request) => {
    if (!request.url().includes(TASK_REPORT_PROCEDURE)) return;
    try {
      collectMeasurements(request.postDataJSON(), reports);
    } catch {
      // A malformed report will remain absent and fail the bounded assertion
      // below; never hide it by manufacturing a partial payload here.
    }
  };
  page.on('request', onRequest);

  return {
    reportsFor: (task: MeasuredTask) => reports.filter(report => report.task === task),
    detach: () => page.off('request', onRequest),
  };
}

export async function expectTaskMeasurement(
  tracker: ReturnType<typeof attachTaskMeasurementTracker>,
  expected: {
    task: MeasuredTask;
    route: string;
    outcome: BrowserTaskMeasurement['outcome'];
    reportIndex?: number;
    backtrackCount?: number;
    validationErrorCount?: number;
    recoveryAttemptCount?: number;
  }
): Promise<BrowserTaskMeasurement> {
  const reportIndex = expected.reportIndex ?? 0;
  await expect
    .poll(() => tracker.reportsFor(expected.task)[reportIndex] ?? null, {
      timeout: 15_000,
      message: `waiting for ${expected.task} task measurement ${reportIndex}`,
    })
    .not.toBeNull();

  const report = tracker.reportsFor(expected.task)[reportIndex]!;
  expect(report).toMatchObject({
    task: expected.task,
    route: expected.route,
    outcome: expected.outcome,
    ...(expected.backtrackCount === undefined ? {} : { backtrackCount: expected.backtrackCount }),
    ...(expected.validationErrorCount === undefined
      ? {}
      : { validationErrorCount: expected.validationErrorCount }),
    ...(expected.recoveryAttemptCount === undefined
      ? {}
      : { recoveryAttemptCount: expected.recoveryAttemptCount }),
  });
  expect(report.timeToFirstUsableControlMs).not.toBeNull();
  expect(report.timeToFirstUsableControlMs).toBeGreaterThanOrEqual(0);
  expect(report.timeToFirstUsableControlMs).toBeLessThanOrEqual(report.durationMs);
  return report;
}
