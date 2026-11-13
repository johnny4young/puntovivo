/**
 * Messages between main and the server worker. Pure data and pure functions,
 * so both sides and `node --test` share one definition.
 */
import type { EmbeddedServerOperations } from './contract.ts';

export type OperationName = keyof EmbeddedServerOperations;

/** Every operation main may call; anything else is rejected by the worker. */
export const OPERATION_NAMES = [
  'inject',
  'verifyAccessToken',
  'getSetupToken',
  'isOwnerRecoveryAvailable',
  'recoverOwner',
  'recordAudit',
  'readAppSetting',
  'writeAppSetting',
  'getSyncStatus',
  'triggerSync',
  'readRestoreDrillCounts',
] as const satisfies readonly OperationName[];

/** An error as it crosses the boundary: no stack, no object graph. */
export interface SerializedError {
  name: string;
  message: string;
  code?: string;
}

/** What the worker needs to open the database and listen. */
export interface WorkerStartOptions {
  serverOptions: Record<string, unknown>;
  /** Present when the install has a durable anchor store (sealed key). */
  auditAnchorStore?: { dataDir: string; platform: NodeJS.Platform };
}

export type MainToWorkerMessage =
  | { type: 'start'; options: WorkerStartOptions }
  | { type: 'call'; id: number; op: OperationName; args: unknown[] }
  | { type: 'stop' }
  /** Honoured only when the app runs under E2E or soak; see server-worker.ts. */
  | { type: 'test-crash' };

export type WorkerToMainMessage =
  | { type: 'started'; url: string }
  | { type: 'start-failed'; error: SerializedError }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: SerializedError }
  | { type: 'stopped'; error?: SerializedError }
  /** Sent by the crash handler right before an uncaught exception ends the thread. */
  | { type: 'crashed'; error: SerializedError };

export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/;

/** Keeps a closed error code (own or from `cause`) and drops everything else. */
export function serializeError(error: unknown): SerializedError {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { errorCode?: unknown };
  } | null;
  const code = [candidate?.code, candidate?.cause?.errorCode].find(
    value => typeof value === 'string' && CODE_PATTERN.test(value)
  ) as string | undefined;
  return {
    name: typeof candidate?.name === 'string' ? candidate.name : 'Error',
    message: typeof candidate?.message === 'string' ? candidate.message : String(error),
    ...(code ? { code } : {}),
  };
}

/** Rebuilds an Error on the receiving side. */
export function deserializeError(serialized: SerializedError): Error {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.code) Object.assign(error, { code: serialized.code });
  return error;
}

export function isOperationName(value: unknown): value is OperationName {
  return (OPERATION_NAMES as readonly unknown[]).includes(value);
}

/** Runs one call message against the operations and builds its reply. */
export async function dispatchCall(
  operations: EmbeddedServerOperations,
  message: { id: number; op: unknown; args: unknown }
): Promise<WorkerToMainMessage> {
  if (!isOperationName(message.op) || !Array.isArray(message.args)) {
    return {
      type: 'result',
      id: message.id,
      ok: false,
      error: { name: 'Error', message: 'SERVER_HOST_OPERATION_REJECTED' },
    };
  }
  try {
    const operation = operations[message.op] as (...args: unknown[]) => Promise<unknown>;
    const value = await operation.apply(operations, message.args);
    return { type: 'result', id: message.id, ok: true, value };
  } catch (error) {
    return { type: 'result', id: message.id, ok: false, error: serializeError(error) };
  }
}
