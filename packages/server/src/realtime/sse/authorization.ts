/**
 * Who may subscribe to each realtime collection.
 *
 * The SSE endpoint used to authenticate without authorizing: any signed-in
 * cashier could ask for `collections=sales` — or omit the parameter
 * entirely, which the manager read as "every collection" — and follow each
 * completed sale of the tenant live, including totals the surface that owns
 * that collection gates behind manager+.
 *
 * The policy below mirrors the surface that CONSUMES each collection, so a
 * stream can never deliver what the consuming UI would refuse to render:
 *
 * - `kds`   → the kitchen board (/kds): sales roles, and the collection
 *   exists only because the kds module does, so it carries a module gate.
 * - `sales` → the owner companion (/c): manager or admin. No module gate:
 *   the sale lifecycle is a generic collection that predates the companion
 *   and will outlive it, so pinning it to that module would misauthorize
 *   the next manager surface that listens. The companion's own module gate
 *   lives at its route.
 *
 * A collection absent from this table is not subscribable at all. That is
 * deliberate: adding a broadcast without deciding who may hear it should
 * fail closed rather than stream to every authenticated session.
 *
 * @module realtime/sse/authorization
 */

import { MANAGER_OR_ADMIN_ROLES, SALES_ROLES, type UserRole } from '@puntovivo/shared/roles';
import type { DatabaseInstance } from '../../db/index.js';
import type { ModuleId } from '../../services/modules/manifest.js';
import { isModuleActiveForTenant } from '../../trpc/middleware/modules.js';

export interface RealtimeCollectionPolicy {
  roles: readonly UserRole[];
  /** Module that must be active for the collection to be subscribable. */
  module: ModuleId | null;
}

export const REALTIME_COLLECTION_POLICIES = {
  kds: { roles: SALES_ROLES, module: 'kds' },
  sales: { roles: MANAGER_OR_ADMIN_ROLES, module: null },
} as const satisfies Record<string, RealtimeCollectionPolicy>;

export type RealtimeCollection = keyof typeof REALTIME_COLLECTION_POLICIES;

const KNOWN_COLLECTIONS = Object.keys(REALTIME_COLLECTION_POLICIES) as RealtimeCollection[];

/**
 * Read a policy through the interface rather than the literal table type.
 * `as const satisfies` keeps the table honest at declaration, but narrows
 * each `roles` to its own tuple, which would make a membership test reject
 * every role the tuple happens not to list.
 */
function policyFor(collection: RealtimeCollection): RealtimeCollectionPolicy {
  return REALTIME_COLLECTION_POLICIES[collection];
}

export function isRealtimeCollection(value: string): value is RealtimeCollection {
  return Object.hasOwn(REALTIME_COLLECTION_POLICIES, value);
}

/** Collections this role may hear, ignoring module state. */
export function collectionsAllowedForRole(role: UserRole): RealtimeCollection[] {
  return KNOWN_COLLECTIONS.filter(collection => policyFor(collection).roles.includes(role));
}

/**
 * Resolve what a subscriber actually gets.
 *
 * An ABSENT or empty request resolves to every collection the role may
 * hear — never to "everything", which is what the wildcard-by-omission
 * behaviour amounted to. A request naming collections is intersected with
 * the role's set, so an unknown or forbidden name is dropped rather than
 * failing the whole subscription; an empty result means the caller may
 * hear nothing and the endpoint answers 403.
 */
export function authorizeRealtimeCollections(
  role: UserRole,
  requested: readonly string[]
): RealtimeCollection[] {
  const allowed = collectionsAllowedForRole(role);
  if (requested.length === 0) {
    return allowed;
  }
  return allowed.filter(collection => requested.includes(collection));
}

/** Module gate for a collection, or null when it has none. */
export function moduleGateForCollection(collection: RealtimeCollection): ModuleId | null {
  return policyFor(collection).module;
}

/**
 * The whole subscription decision in one place: role first (in memory),
 * then the module gate (one read on `tenants` per gated collection).
 * Order matters for the same reason it does in the tRPC module middleware
 * — never pay a DB read for a collection the role could not hear anyway.
 *
 * An empty result means the caller may hear nothing, and the endpoint
 * answers 403 rather than opening a stream that would stay silent.
 */
export async function resolveRealtimeSubscription(args: {
  db: DatabaseInstance;
  tenantId: string;
  role: UserRole;
  requested: readonly string[];
}): Promise<RealtimeCollection[]> {
  const { db, tenantId, role, requested } = args;
  const granted: RealtimeCollection[] = [];

  for (const collection of authorizeRealtimeCollections(role, requested)) {
    const moduleId = moduleGateForCollection(collection);
    if (moduleId && !(await isModuleActiveForTenant(db, tenantId, moduleId))) {
      continue;
    }
    granted.push(collection);
  }

  return granted;
}

/**
 * Re-check a long-lived stream against mutable module state.
 *
 * Access-token verification already closes the connection when the tenant,
 * user or role changes. Module switches are independent tenant settings, so
 * they must be checked again as well; otherwise disabling KDS would leave an
 * already-open kitchen stream authorized until the browser disconnects.
 *
 * The original grant is used as the requested set. Any removed collection
 * closes the stream and lets the normal reconnect negotiate a fresh grant.
 */
export async function isRealtimeSubscriptionStillAuthorized(args: {
  db: DatabaseInstance;
  tenantId: string;
  role: UserRole;
  granted: readonly RealtimeCollection[];
}): Promise<boolean> {
  const current = await resolveRealtimeSubscription({
    db: args.db,
    tenantId: args.tenantId,
    role: args.role,
    requested: args.granted,
  });

  return (
    current.length === args.granted.length &&
    current.every((collection, index) => collection === args.granted[index])
  );
}
