import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { useRef } from 'react';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { buildCriticalCommandHeaders, mintEnvelope, type MintedEnvelope } from './commandEnvelope';
import { getCachedDeviceIdSync } from './deviceId';
import { getStoredSiteId } from '@/features/tenant/siteStorage';
import { createTrpcClientWithHeaders } from './trpc';

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * closed list of critical procedure paths from ADR-0002.
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
  // change the restaurant table a suspended draft is
  // open on (or detach the FK to free-text). Server uses
  // `criticalCommandManagerOrAdminProcedure` (manager/admin only —
  // transferring drafts between physical tables is an operations
  // override) so the client must mint an envelope AND the panel CTA
  // must gate on role.
  | 'sales.changeTable'
  // split-bill: subset of items moved out of a suspended
  // draft into a brand-new suspended draft. Server uses
  // `criticalCommandManagerOrAdminProcedure` (manager/admin only —
  // same rationale as `changeTable`); the client must mint an
  // envelope AND the panel CTA must gate on role + catalog presence.
  | 'sales.splitDraft'
  | 'cashSessions.open'
  | 'cashSessions.close'
  | 'cashSessions.recordMovement'
  | 'inventory.adjustStock'
  | 'inventory.createMovement'
  | 'inventory.createCountSession'
  | 'inventory.saveCountSession'
  | 'inventory.submitCountSession'
  | 'inventory.approveCountSession'
  | 'inventory.rejectCountSession'
  | 'transfers.create'
  | 'transfers.receive'
  | 'transfers.void'
  | 'purchases.create'
  | 'purchases.createFromOrder'
  | 'purchases.returnPurchase'
  | 'purchases.void'
  | 'orders.create'
  | 'orders.submitDraft'
  | 'orders.void'
  | 'providerPayables.createInvoice'
  | 'providerPayables.createOpeningBalance'
  | 'providerPayables.recordPayment'
  | 'providerPayables.recordCredit'
  | 'users.create'
  | 'users.update'
  | 'users.setStaffPin'
  | 'employeeShifts.clockIn'
  | 'employeeShifts.clockOut'
  // explicit, auditable rest intervals for the active employee shift.
  | 'employeeShifts.breaks.start'
  | 'employeeShifts.breaks.end'
  // durable manager-authored schedule lifecycle.
  | 'employeeShifts.schedule.create'
  | 'employeeShifts.schedule.update'
  | 'employeeShifts.schedule.cancel'
  // append one immutable effective attendance snapshot.
  | 'employeeShifts.attendance.corrections.create'
  | 'managerApprovals.request'
  | 'managerApprovals.decideWithPin'
  | 'managerApprovals.cancel'
  | 'peripherals.kickCashDrawer'
  | 'peripherals.buildDrawerKickBytes'
  | 'auth.changePassword'
  // module activation toggle. Server-side wraps with
  // `criticalCommandAdminProcedure` so the client must mint an
  // envelope + ship the device id; the audit row carries the
  // operationId for after-the-fact traceability.
  | 'modules.setActive'
  // irreversible manager/admin attestation of one frozen
  // comprehensive day-close snapshot.
  | 'reports.dayClose.signOff'
  // money-sensitive per-role checkout authority policy.
  | 'lossPrevention.updateSettings'
  // shared, auditable manager review of one alert.
  | 'lossPrevention.acknowledgeAlert'
  // A-30 — apply a vertical module preset. Same critical-command gate as
  // setActive (admin + envelope + device id).
  | 'modules.applyPreset';

/**
 * Recursively project router inputs / outputs through a dotted path. Most
 * commands are `namespace.procedure`; reports.dayClose.signOff demonstrates
 * the nested sub-router shape.
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

interface ActiveCriticalCall {
  envelope: MintedEnvelope;
  promise: Promise<unknown> | null;
  createdAtMs: number;
  /**
   * Execution scope captured when the envelope was minted. A retained
   * envelope is a claim about one specific attempt, so its retry must reach
   * the same device and the same site. Re-reading either at retry time lets
   * an operator who switched sites (or a device that re-registered) replay
   * the same logical command into a different scope: the site would execute
   * the intent somewhere it was never authorised, and a new device id misses
   * the original idempotency row entirely and runs the command twice.
   */
  deviceId: string;
  siteId: string | null;
}

const CRITICAL_CALL_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Stable JSON identity for concurrent clicks and React Query retries. */
function canonicalizeMutationInput(value: unknown): string {
  return (
    JSON.stringify(value, (_key, nested) =>
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? Object.fromEntries(
            Object.entries(nested as Record<string, unknown>).sort(([left], [right]) =>
              left.localeCompare(right)
            )
          )
        : nested
    ) ?? 'null'
  );
}

function hasStructuredServerResponse(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object') return true;
  const shapeData = (error as { shape?: { data?: unknown } }).shape?.data;
  return !!shapeData && typeof shapeData === 'object';
}

function extractRetriableCommandCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidates = [
    (error as { data?: { errorCode?: unknown } }).data?.errorCode,
    (error as { shape?: { data?: { errorCode?: unknown } } }).shape?.data?.errorCode,
    (error as { errorCode?: unknown }).errorCode,
  ];
  const code = candidates.find(candidate => typeof candidate === 'string');
  return typeof code === 'string' ? code : null;
}

function shouldRetainEnvelopeAfterError(error: unknown): boolean {
  const code = extractRetriableCommandCode(error);
  if (code === 'COMMAND_IN_PROGRESS' || code === 'COMMAND_DATABASE_BUSY') return true;
  // No structured tRPC response means the client cannot know whether the
  // command committed before the connection failed. Reusing the envelope is
  // the only safe retry; a fresh key could execute the same money/stock write.
  return !hasStructuredServerResponse(error);
}

function pruneRetainedCalls(calls: Map<string, ActiveCriticalCall>): void {
  const cutoff = Date.now() - CRITICAL_CALL_RETENTION_MS;
  for (const [key, call] of calls) {
    if (call.promise === null && call.createdAtMs <= cutoff) {
      calls.delete(key);
    }
  }
}

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
 * `DEVICE_NOT_REGISTERED` if absent (caller must surface the
 * error so the operator re-runs `auth.registerDevice`).
 * 2. Mints one `CommandEnvelope` per logical input. Concurrent duplicate
 * clicks share the same in-flight Promise, while React Query retries reuse the
 * same envelope. Successes and explicit server rejections clear the identity;
 * uncertain transport failures and busy/in-progress responses retain it for a
 * later safe retry. Retained failures expire with the server's 24-hour replay
 * window and are released when the owning component unmounts.
 * 3. Builds a one-shot tRPC client with the device + envelope
 * headers and dispatches against the resolved procedure.
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
  const activeCalls = useRef(new Map<string, ActiveCriticalCall>());
  const { onSettled, ...mutationOptions } = options ?? {};

  return useMutation<OutputOfPath<TPath>, Error, InputOfPath<TPath>>({
    ...mutationOptions,
    mutationKey: ['criticalCommand', path],
    mutationFn: async (input: InputOfPath<TPath>) => {
      const deviceId = getCachedDeviceIdSync();
      if (!deviceId) {
        throw createMissingDeviceError();
      }

      const inputKey = canonicalizeMutationInput(input);
      let active = activeCalls.current.get(inputKey);
      if (!active) {
        pruneRetainedCalls(activeCalls.current);
        active = {
          envelope: mintEnvelope(),
          promise: null,
          createdAtMs: Date.now(),
          deviceId,
          siteId: getStoredSiteId(),
        };
        activeCalls.current.set(inputKey, active);
      }

      if (!active.promise) {
        // Pin the retry to the scope the envelope was minted in. The site
        // header is set explicitly because the shared header factory reads
        // the CURRENT selection on every request, which would otherwise
        // override the captured one on a retry.
        const headers = buildCriticalCommandHeaders(active.deviceId, active.envelope);
        if (active.siteId) headers['x-site-id'] = active.siteId;
        const client = createTrpcClientWithHeaders(headers);
        active.promise = invokeCriticalMutation(client, path, input).catch(error => {
          active!.promise = null;
          throw error;
        });
      }

      return (await active.promise) as OutputOfPath<TPath>;
    },
    onSettled: async (data, error, variables, onMutateResult, context) => {
      if (!error || !shouldRetainEnvelopeAfterError(error)) {
        activeCalls.current.delete(canonicalizeMutationInput(variables));
      }
      await onSettled?.(data, error, variables, onMutateResult, context);
    },
  });
}
