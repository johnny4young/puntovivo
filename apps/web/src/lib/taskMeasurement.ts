/**
 * Privacy-safe, aggregate measurement for high-value operator tasks.
 *
 * This module deliberately has no generic `metadata`, label, error, or route
 * parameter. A caller can only choose a fixed task; the route is derived
 * locally and the server repeats the same allowlist validation. Measurements
 * contain integer timings/counts plus coarse outcomes — never product,
 * customer, payment, sale, site, query, note, or free-text content.
 *
 * Delivery is sampled and best-effort. Tenant consent remains authoritative
 * on the server, which drops every authenticated sample while telemetry is
 * disabled.
 *
 * @module lib/taskMeasurement
 */

import { useEffect, useRef, useState } from 'react';
import { resolveDeviceClass, type DeviceClass } from './observability';
import { vanillaClient } from './trpc';

export const TASK_MEASUREMENT_ROUTE = {
  complete_sale: '/sales',
  create_product: '/products',
  close_day: '/day-close',
  receive_stock: '/purchases',
  recover_operation: '/operations',
} as const;

export type TaskMeasurementTask = keyof typeof TASK_MEASUREMENT_ROUTE;
export type TaskMeasurementRoute = (typeof TASK_MEASUREMENT_ROUTE)[TaskMeasurementTask];
export type TaskMeasurementOutcome = 'success' | 'abandoned' | 'failed';
export type TaskMeasurementRecoveryOutcome = 'not_needed' | 'succeeded' | 'failed' | 'abandoned';

export interface TaskMeasurementPayload {
  task: TaskMeasurementTask;
  route: TaskMeasurementRoute;
  taskVersion: number;
  outcome: TaskMeasurementOutcome;
  recoveryOutcome: TaskMeasurementRecoveryOutcome;
  deviceClass: DeviceClass;
  durationMs: number;
  timeToFirstUsableControlMs: number | null;
  timeToFirstProgressMs: number | null;
  interactionsToFirstProgress: number | null;
  interactionCount: number;
  backtrackCount: number;
  validationErrorCount: number;
  recoveryAttemptCount: number;
}

interface TaskMeasurementDependencies {
  now: () => number;
  random: () => number;
  sampleRate: number;
  deviceClass: () => DeviceClass;
  report: (payload: TaskMeasurementPayload) => Promise<unknown>;
}

export interface TaskMeasurementOptions {
  now?: (() => number) | undefined;
  random?: (() => number) | undefined;
  sampleRate?: number | undefined;
  deviceClass?: (() => DeviceClass) | undefined;
  report?: ((payload: TaskMeasurementPayload) => Promise<unknown>) | undefined;
}

const MAX_DURATION_MS = 86_400_000;
const MAX_COUNT = 100_000;
const TASK_VERSION = 1;

function resolveTaskMeasurementSampleRate(): number {
  const raw = import.meta.env.VITE_TASK_MEASUREMENT_SAMPLE_RATE;
  const parsed = raw !== undefined ? Number(raw) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }
  return import.meta.env.PROD ? 0.1 : 1;
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function createDependencies(options: TaskMeasurementOptions): TaskMeasurementDependencies {
  return {
    now: options.now ?? defaultNow,
    random: options.random ?? Math.random,
    sampleRate: options.sampleRate ?? resolveTaskMeasurementSampleRate(),
    deviceClass: options.deviceClass ?? resolveDeviceClass,
    report:
      options.report ??
      (payload => vanillaClient.observability.reportTaskMeasurement.mutate(payload)),
  };
}

class TaskMeasurementSession {
  readonly task: TaskMeasurementTask;
  private readonly dependencies: TaskMeasurementDependencies;
  private readonly startedAt: number;
  private readonly sampled: boolean;
  private finished = false;
  private firstUsableControlAt: number | null = null;
  private firstProgressAt: number | null = null;
  private interactionsAtFirstProgress: number | null = null;
  private interactionCount = 0;
  private backtrackCount = 0;
  private validationErrorCount = 0;
  private recoveryAttemptCount = 0;
  private recoveryOutcome: TaskMeasurementRecoveryOutcome = 'not_needed';

  constructor(task: TaskMeasurementTask, dependencies: TaskMeasurementDependencies) {
    this.task = task;
    this.dependencies = dependencies;
    this.startedAt = dependencies.now();
    this.sampled = dependencies.random() < dependencies.sampleRate;
  }

  markUsableControl(): void {
    if (this.finished || this.firstUsableControlAt !== null) return;
    this.firstUsableControlAt = this.dependencies.now();
  }

  recordInteraction(): void {
    if (this.finished) return;
    this.interactionCount = Math.min(MAX_COUNT, this.interactionCount + 1);
  }

  markFirstProgress(): void {
    if (this.finished || this.firstProgressAt !== null) return;
    this.firstProgressAt = this.dependencies.now();
    this.interactionsAtFirstProgress = this.interactionCount;
  }

  recordBacktrack(): void {
    if (this.finished) return;
    this.backtrackCount = Math.min(MAX_COUNT, this.backtrackCount + 1);
  }

  recordValidationError(): void {
    if (this.finished) return;
    this.validationErrorCount = Math.min(MAX_COUNT, this.validationErrorCount + 1);
  }

  recordRecoveryAttempt(): void {
    if (this.finished) return;
    this.recoveryAttemptCount = Math.min(MAX_COUNT, this.recoveryAttemptCount + 1);
    this.recoveryOutcome = 'abandoned';
  }

  recordRecoveryOutcome(outcome: Exclude<TaskMeasurementRecoveryOutcome, 'not_needed'>): void {
    if (this.finished || this.recoveryAttemptCount === 0) return;
    this.recoveryOutcome = outcome;
  }

  finish(outcome: TaskMeasurementOutcome): void {
    if (this.finished) return;
    this.finished = true;

    const finishedAt = this.dependencies.now();
    const durationMs = boundedInteger(finishedAt - this.startedAt, MAX_DURATION_MS);
    const elapsed = (instant: number | null): number | null =>
      instant === null
        ? null
        : Math.min(durationMs, boundedInteger(instant - this.startedAt, MAX_DURATION_MS));

    const payload: TaskMeasurementPayload = {
      task: this.task,
      route: TASK_MEASUREMENT_ROUTE[this.task],
      taskVersion: TASK_VERSION,
      outcome,
      recoveryOutcome: this.recoveryOutcome,
      deviceClass: this.dependencies.deviceClass(),
      durationMs,
      timeToFirstUsableControlMs: elapsed(this.firstUsableControlAt),
      timeToFirstProgressMs: elapsed(this.firstProgressAt),
      interactionsToFirstProgress: this.interactionsAtFirstProgress,
      interactionCount: this.interactionCount,
      backtrackCount: this.backtrackCount,
      validationErrorCount: this.validationErrorCount,
      recoveryAttemptCount: this.recoveryAttemptCount,
    };

    if (!this.sampled) return;
    try {
      void this.dependencies.report(payload).catch(() => {
        /* best-effort UX measurement — never interrupt the operator task */
      });
    } catch {
      // A malformed adapter or isolated test mock can fail synchronously before
      // returning a Promise. Measurement must remain invisible to the task.
    }
  }
}

/**
 * Stable imperative controller used by page shells and modal flows.
 *
 * `ensure` is intentionally idempotent for React Strict Mode. `start`
 * abandons any different active task before beginning the next attempt.
 */
export class TaskMeasurementController {
  private readonly dependencies: TaskMeasurementDependencies;
  private activeSession: TaskMeasurementSession | null = null;

  constructor(options: TaskMeasurementOptions = {}) {
    this.dependencies = createDependencies(options);
  }

  get activeTask(): TaskMeasurementTask | null {
    return this.activeSession?.task ?? null;
  }

  ensure(task: TaskMeasurementTask): void {
    if (this.activeSession?.task === task) return;
    this.start(task);
  }

  start(task: TaskMeasurementTask): void {
    this.activeSession?.finish('abandoned');
    this.activeSession = new TaskMeasurementSession(task, this.dependencies);
  }

  finish(outcome: TaskMeasurementOutcome): void {
    this.activeSession?.finish(outcome);
    this.activeSession = null;
  }

  markUsableControl(): void {
    this.activeSession?.markUsableControl();
  }

  recordInteraction(): void {
    this.activeSession?.recordInteraction();
  }

  markFirstProgress(): void {
    this.activeSession?.markFirstProgress();
  }

  recordBacktrack(): void {
    this.activeSession?.recordBacktrack();
  }

  recordValidationError(): void {
    this.activeSession?.recordValidationError();
  }

  recordRecoveryAttempt(): void {
    this.activeSession?.recordRecoveryAttempt();
  }

  recordRecoveryOutcome(outcome: Exclude<TaskMeasurementRecoveryOutcome, 'not_needed'>): void {
    this.activeSession?.recordRecoveryOutcome(outcome);
  }
}

/**
 * React lifecycle adapter. Real unmounts emit abandonment, while the deferred
 * check suppresses React Strict Mode's development-only setup/cleanup replay.
 */
export function useTaskMeasurementController(
  options: TaskMeasurementOptions = {}
): TaskMeasurementController {
  const [controller] = useState(() => new TaskMeasurementController(options));
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          controller.finish('abandoned');
        }
      });
    };
  }, [controller]);

  return controller;
}

/** Count keyboard activation parity without counting every typed character. */
export function isTaskActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Escape';
}
