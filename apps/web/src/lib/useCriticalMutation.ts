import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { buildCriticalCommandHeaders, mintEnvelope } from './commandEnvelope';
import { getCachedDeviceIdSync } from './deviceId';
import { createTrpcClientWithHeaders } from './trpc';

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * ENG-052b — closed list of critical procedure paths from ADR-0002.
 *
 * Each entry is the dotted tRPC path (`namespace.procedure`). Adding
 * a new entry here is the only change required when a new procedure
 * gets `criticalCommandProcedure*` on the server side; the input /
 * output types are inferred automatically from `AppRouter`.
 *
 * The list MUST mirror the closed list in
 * `docs/architecture/0002-command-envelope.md` §Closed list. Do not
 * add new entries without first wrapping the server procedure with a
 * `criticalCommand*` decorator — the runtime will throw
 * `MISSING_COMMAND_ENVELOPE` for any path that the client decorates
 * but the server hasn't.
 */
export type CriticalCommandPath =
  | 'sales.create'
  | 'sales.completeDraft'
  | 'sales.suspend'
  | 'sales.resume'
  | 'sales.discardDraft'
  | 'sales.returnSale'
  | 'sales.void'
  | 'sales.getForReprint'
  // ENG-039c2 — change the restaurant table a suspended draft is
  // open on (or detach the FK to free-text). Server uses
  // `criticalCommandManagerOrAdminProcedure` (manager/admin only —
  // transferring drafts between physical tables is an operations
  // override) so the client must mint an envelope AND the panel CTA
  // must gate on role.
  | 'sales.changeTable'
  // ENG-039c3 — split-bill: subset of items moved out of a suspended
  // draft into a brand-new suspended draft. Server uses
  // `criticalCommandManagerOrAdminProcedure` (manager/admin only —
  // same rationale as `changeTable`); the client must mint an
  // envelope AND the panel CTA must gate on role + catalog presence.
  | 'sales.splitDraft'
  | 'cashSessions.open'
  | 'cashSessions.close'
  | 'cashSessions.recordMovement'
  | 'inventory.adjustStock'
  | 'transfers.create'
  | 'transfers.receive'
  | 'transfers.void'
  | 'users.create'
  | 'users.update'
  | 'users.setStaffPin'
  | 'employeeShifts.clockIn'
  | 'employeeShifts.clockOut'
  // ENG-140b — explicit, auditable rest intervals for the active employee shift.
  | 'employeeShifts.breaks.start'
  | 'employeeShifts.breaks.end'
  // ENG-140a — durable manager-authored schedule lifecycle.
  | 'employeeShifts.schedule.create'
  | 'employeeShifts.schedule.update'
  | 'employeeShifts.schedule.cancel'
  // ENG-140e — append one immutable effective attendance snapshot.
  | 'employeeShifts.attendance.corrections.create'
  | 'managerApprovals.request'
  | 'managerApprovals.decideWithPin'
  | 'managerApprovals.cancel'
  | 'peripherals.kickCashDrawer'
  | 'peripherals.buildDrawerKickBytes'
  | 'auth.changePassword'
  // ENG-068 — module activation toggle. Server-side wraps with
  // `criticalCommandAdminProcedure` so the client must mint an
  // envelope + ship the device id; the audit row carries the
  // operationId for after-the-fact traceability.
  | 'modules.setActive'
  // ENG-141b — irreversible manager/admin attestation of one frozen
  // comprehensive day-close snapshot.
  | 'reports.dayClose.signOff'
  // ENG-142a — money-sensitive per-role checkout authority policy.
  | 'lossPrevention.updateSettings'
  // ENG-142d — shared, auditable manager review of one alert.
  | 'lossPrevention.acknowledgeAlert'
  // A-30 — apply a vertical module preset. Same critical-command gate as
  // setActive (admin + envelope + device id).
  | 'modules.applyPreset';

/**
 * Recursively project router inputs / outputs through a dotted path. Most
 * commands are `namespace.procedure`; ENG-141b is the first critical command
 * under a nested sub-router (`reports.dayClose.signOff`).
 */
type ValueAtPath<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? ValueAtPath<T[Head], Tail>
    : never
  : P extends keyof T
    ? T[P]
    : never;

type InputOfPath<P extends CriticalCommandPath> = ValueAtPath<RouterInputs, P>;
type OutputOfPath<P extends CriticalCommandPath> = ValueAtPath<RouterOutputs, P>;

type LocalServerCodeError = Error & {
  errorCode: 'DEVICE_NOT_REGISTERED';
};

function createMissingDeviceError(): LocalServerCodeError {
  const error = new Error(
    'Device registration is required before running this critical command.'
  ) as LocalServerCodeError;
  error.errorCode = 'DEVICE_NOT_REGISTERED';
  return error;
}

/**
 * Invoke the procedure resolved from the dotted path against a
 * vanilla tRPC client. The tRPC v11 client exposes each leaf as a
 * Proxy where `mutate` is the operation handle; we therefore call it
 * inline via a lambda instead of `.bind(proc)`, which mis-binds when
 * `proc` is itself a Proxy.
 */
async function invokeCriticalMutation(
  client: ReturnType<typeof createTrpcClientWithHeaders>,
  path: CriticalCommandPath,
  input: unknown
): Promise<unknown> {
  const segments = path.split('.');
  let cursor: unknown = client;
  for (const segment of segments) {
    if (!cursor || (typeof cursor !== 'object' && typeof cursor !== 'function')) {
      cursor = undefined;
      break;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  const proc = cursor as { mutate?: (input: unknown) => Promise<unknown> } | undefined;
  if (!proc || typeof proc.mutate !== 'function') {
    throw new Error(`Unknown critical procedure path: ${path}`);
  }
  return proc.mutate(input);
}

/**
 * React Query hook for any critical procedure listed in
 * `CriticalCommandPath`. Behaviour:
 *
 * 1. Reads the cached device id synchronously. Throws
 *    `DEVICE_NOT_REGISTERED` if absent (caller must surface the
 *    error so the operator re-runs `auth.registerDevice`).
 * 2. Mints a fresh `CommandEnvelope` per `mutate()` call so each
 *    invocation has its own `idempotencyKey` + `operationId`. Retry
 *    semantics are intentionally orchestrated through the Query
 *    layer: re-calling `mutate()` mints a new envelope (server
 *    produces a new row); only an explicit React Query retry with
 *    the same envelope hits the server's idempotent cache.
 * 3. Builds a one-shot tRPC client with the device + envelope
 *    headers and dispatches against the resolved procedure.
 *
 * The generic `TPath` extends `CriticalCommandPath`; input + output
 * types are inferred automatically from `AppRouter`.
 */
export function useCriticalMutation<TPath extends CriticalCommandPath>(
  path: TPath,
  options?: Omit<
    UseMutationOptions<OutputOfPath<TPath>, Error, InputOfPath<TPath>>,
    'mutationKey' | 'mutationFn'
  >
) {
  return useMutation<OutputOfPath<TPath>, Error, InputOfPath<TPath>>({
    mutationKey: ['criticalCommand', path],
    mutationFn: async (input: InputOfPath<TPath>) => {
      const deviceId = getCachedDeviceIdSync();
      if (!deviceId) {
        throw createMissingDeviceError();
      }

      const headers = buildCriticalCommandHeaders(deviceId, mintEnvelope());
      const client = createTrpcClientWithHeaders(headers);
      return (await invokeCriticalMutation(client, path, input)) as OutputOfPath<TPath>;
    },
    ...options,
  });
}
