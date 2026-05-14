import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import {
  buildCriticalCommandHeaders,
  mintEnvelope,
} from './commandEnvelope';
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
  | 'cashSessions.open'
  | 'cashSessions.close'
  | 'cashSessions.recordMovement'
  | 'inventory.adjustStock'
  | 'transfers.create'
  | 'transfers.receive'
  | 'transfers.void'
  | 'users.create'
  | 'users.update'
  | 'auth.changePassword'
  // ENG-068 — module activation toggle. Server-side wraps with
  // `criticalCommandAdminProcedure` so the client must mint an
  // envelope + ship the device id; the audit row carries the
  // operationId for after-the-fact traceability.
  | 'modules.setActive';

/**
 * Split a `'ns.proc'` path into its `[ns, proc]` tuple at the type
 * level. Used to project router inputs / outputs down to a single
 * procedure based on the consumer's path argument.
 */
type SplitPath<S extends string> = S extends `${infer NS}.${infer PR}`
  ? [NS, PR]
  : never;

type InputOfPath<P extends CriticalCommandPath> =
  SplitPath<P> extends [infer NS, infer PR]
    ? NS extends keyof RouterInputs
      ? PR extends keyof RouterInputs[NS]
        ? RouterInputs[NS][PR]
        : never
      : never
    : never;

type OutputOfPath<P extends CriticalCommandPath> =
  SplitPath<P> extends [infer NS, infer PR]
    ? NS extends keyof RouterOutputs
      ? PR extends keyof RouterOutputs[NS]
        ? RouterOutputs[NS][PR]
        : never
      : never
    : never;

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
  const [namespace, procedure] = path.split('.') as [string, string];
  const ns = (client as unknown as Record<string, Record<string, { mutate: (input: unknown) => Promise<unknown> }>>)[namespace];
  const proc = ns?.[procedure];
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
