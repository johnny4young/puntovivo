import { StrictMode, useEffect } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  TaskMeasurementController,
  isTaskActivationKey,
  useTaskMeasurementController,
  type TaskMeasurementPayload,
} from '../taskMeasurement';

function createHarness() {
  let now = 1_000;
  const report = vi.fn(async (_payload: TaskMeasurementPayload) => ({ accepted: true }));
  const controller = new TaskMeasurementController({
    now: () => now,
    random: () => 0,
    sampleRate: 1,
    deviceClass: () => 'mid',
    report,
  });
  return {
    controller,
    report,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

describe('TaskMeasurementController', () => {
  it('emits a fixed aggregate shape with derived route and integer timings', () => {
    const { controller, report, advance } = createHarness();
    controller.ensure('complete_sale');
    advance(125.4);
    controller.markUsableControl();
    controller.recordInteraction();
    controller.recordInteraction();
    advance(800.2);
    controller.markFirstProgress();
    controller.recordInteraction();
    controller.recordBacktrack();
    controller.recordValidationError();
    controller.recordRecoveryAttempt();
    controller.recordRecoveryOutcome('succeeded');
    advance(2_000.3);
    controller.finish('success');

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      task: 'complete_sale',
      route: '/sales',
      taskVersion: 1,
      outcome: 'success',
      recoveryOutcome: 'succeeded',
      deviceClass: 'mid',
      durationMs: 2_926,
      timeToFirstUsableControlMs: 125,
      timeToFirstProgressMs: 926,
      interactionsToFirstProgress: 2,
      interactionCount: 3,
      backtrackCount: 1,
      validationErrorCount: 1,
      recoveryAttemptCount: 1,
    });
  });

  it('is idempotent, samples per attempt, and never accepts arbitrary route/content fields', () => {
    const { controller, report, advance } = createHarness();
    controller.ensure('create_product');
    advance(50);
    controller.finish('failed');
    controller.finish('success');

    expect(report).toHaveBeenCalledTimes(1);
    const payload = report.mock.calls[0]?.[0];
    expect(payload?.route).toBe('/products');
    expect(payload).not.toHaveProperty('productId');
    expect(payload).not.toHaveProperty('customerId');
    expect(payload).not.toHaveProperty('paymentMethod');
    expect(payload).not.toHaveProperty('saleId');
    expect(payload).not.toHaveProperty('metadata');
    expect(payload).not.toHaveProperty('error');
  });

  it('marks an unfinished recovery attempt as abandoned', () => {
    const { controller, report, advance } = createHarness();
    controller.ensure('receive_stock');
    controller.recordRecoveryAttempt();
    advance(400);
    controller.finish('abandoned');

    expect(report.mock.calls[0]?.[0]).toMatchObject({
      task: 'receive_stock',
      outcome: 'abandoned',
      recoveryOutcome: 'abandoned',
      recoveryAttemptCount: 1,
    });
  });

  it('skips unsampled attempts and swallows reporter failures', async () => {
    const skippedReport = vi.fn(async () => ({ accepted: true }));
    const skipped = new TaskMeasurementController({
      sampleRate: 0,
      random: () => 0.5,
      report: skippedReport,
    });
    skipped.ensure('complete_sale');
    skipped.finish('success');
    expect(skippedReport).not.toHaveBeenCalled();

    const rejectedReport = vi.fn(async () => {
      throw new Error('offline');
    });
    const bestEffort = new TaskMeasurementController({
      sampleRate: 1,
      random: () => 0,
      report: rejectedReport,
    });
    bestEffort.ensure('complete_sale');
    expect(() => bestEffort.finish('success')).not.toThrow();
    await Promise.resolve();
    expect(rejectedReport).toHaveBeenCalledTimes(1);
  });
});

describe('useTaskMeasurementController', () => {
  it('suppresses Strict Mode replay but reports a real unmount as abandonment', async () => {
    const report = vi.fn(async (_payload: TaskMeasurementPayload) => ({ accepted: true }));

    function Harness() {
      const controller = useTaskMeasurementController({
        now: () => 100,
        random: () => 0,
        sampleRate: 1,
        deviceClass: () => 'unknown',
        report,
      });
      useEffect(() => {
        controller.ensure('complete_sale');
      }, [controller]);
      return null;
    }

    const view = render(
      <StrictMode>
        <Harness />
      </StrictMode>
    );
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();

    view.unmount();
    await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[0]).toMatchObject({
      task: 'complete_sale',
      outcome: 'abandoned',
    });
  });
});

describe('isTaskActivationKey', () => {
  it('counts activation/backtrack keys without counting ordinary typing', () => {
    expect(isTaskActivationKey('Enter')).toBe(true);
    expect(isTaskActivationKey(' ')).toBe(true);
    expect(isTaskActivationKey('Escape')).toBe(true);
    expect(isTaskActivationKey('a')).toBe(false);
  });
});
