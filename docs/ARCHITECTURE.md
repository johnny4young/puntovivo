# Puntovivo Architecture

Puntovivo is a local-first modular monolith. The browser and Electron renderer
share one React application; Fastify and tRPC own business APIs; SQLite is the
operational authority. In Electron, the Fastify server runs in-process inside
main rather than as a child process.

![Puntovivo architecture](./architecture.svg)

Source diagram: [architecture.mmd](./architecture.mmd).

## Repository map

| Path              | Responsibility                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | React application, routes, role/module gates, user workflows, i18n, and browser tests.                                      |
| `apps/desktop`    | Electron lifecycle, sandboxed window, preload bridge, updater, local peripherals, encrypted storage, and backup operations. |
| `packages/server` | Fastify host, tRPC routers, application services, persistence, workers, fiscal, sync, payments, and tests.                  |
| `packages/shared` | Cross-workspace contracts such as roles, money, and approval types.                                                         |
| `e2e`             | Browser and Electron end-to-end journeys.                                                                                   |
| `scripts`         | CI, release, performance, setup, migration, and runtime guards.                                                             |

## Runtime shape

```text
React renderer
  -> tRPC client
    -> Fastify /api/trpc
      -> authenticated tenant/site context
        -> role and site guards
          -> application services
            -> Drizzle + SQLite transaction
              -> audit, journal, and outbox evidence
```

The browser target connects to a standalone Fastify process. The Electron
target imports `@puntovivo/server` directly into main and serves the same tRPC
surface to its renderer.

## API and application boundaries

- `/api/trpc` is the canonical application API.
- `/api/health` remains a compatibility and operational health endpoint.
- `/api/realtime/*` carries server-sent events.
- Routers validate input, authorize the actor, enforce tenant/site scope, and
  delegate non-trivial rules to application or service modules.
- Server tests call `appRouter.createCaller(...)` against in-memory SQLite;
  they do not allocate HTTP ports.
- Every operation accepting a site identifier validates that the site belongs
  to the active tenant.

## Persistence invariants

- Drizzle migrations are the only schema-change path.
- Every business query is tenant scoped. Site-owned workflows add site scope.
- Money is stored and validated under the shared rounding contract.
- Sale completion requires an active cash session for tenant, site, and
  cashier.
- Versioned mutable resources use compare-and-swap updates and report conflicts
  rather than silently overwriting concurrent edits.
- Fiscal, payment, hardware, and sync effects use dedicated durable outboxes.
- The operation journal and audit log preserve who changed sensitive state and
  which effects committed.
- Signed day-close evidence and fiscal snapshots are immutable.

## Local storage and recovery

Packaged Electron databases use SQLCipher. The database key is obtained through
Electron secure storage and never crosses into the renderer. Node and Electron
use different native ABIs; the runtime selector caches compatible SQLite
bindings rather than assuming one binary works everywhere.

Backups are encrypted bundles with integrity inspection. Creation checkpoints
the WAL first. Restore uses staging, format detection, key validation, and a
server restart boundary. Scheduled snapshots, restore drills, backup-protection
status, and S3-compatible cloud-vault upload all remain main-process
capabilities.

## Electron security boundary

The main window uses `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`. Renderer code cannot read files, spawn processes, open native
sockets, or import Node modules.

Every desktop capability follows:

```text
renderer -> contextBridge wrapper -> ipcRenderer.invoke
         -> validated ipcMain.handle -> main-process capability
```

Preload wrappers stay narrow and declarative. Business data normally flows over
tRPC; IPC is reserved for desktop-only lifecycle, storage, updater, backup,
printing, and local-device capabilities.

## Sync and Authority Node

The local database remains authoritative. `sync_outbox` records eventual
replication work and conflict policy without making network availability a
precondition for a local sale. Runtime modes are:

- `device_local` — one installation owns its local authority;
- `site_hub` — a LAN-accessible authority for a store;
- `hub_client` — a terminal that submits commands to the store hub and may use
  a local hardware bridge.

The sync kernel is implemented, but it is not a promise of hosted, offline
multi-master cloud replication. Public readiness and known operational gaps are
listed in [PROJECT-STATUS.md](./PROJECT-STATUS.md).

## Module and UI architecture

Routes are lazy loaded and protected by authentication, role, site, and module
state. Server and web share the role contract. TanStack Query owns server
state; Zustand or component state owns client-only interaction state. Visible
copy lives in bilingual locale namespaces and Spanish uses neutral Latin
American `tú` forms.

Vertical modules may exist without being part of the retail production wedge.
Inactive modules must not add navigation, permissions, or operational noise.

## Durable decisions

Architecture Decision Records in [architecture/](./architecture/README.md)
own decisions that future changes must preserve:

- local-store authority;
- command envelope;
- outbox taxonomy;
- conflict policy;
- sync payload contract;
- local data security;
- module activation;
- Authority Node runtime modes;
- money storage and validation;
- labor overtime evidence.

## Related references

- [TRPC_ARCHITECTURE.md](./TRPC_ARCHITECTURE.md)
- [TRPC_TESTING_GUIDE.md](./TRPC_TESTING_GUIDE.md)
- [DESKTOP_RUNTIME_GUIDE.md](./DESKTOP_RUNTIME_GUIDE.md)
- [SECURITY.md](./SECURITY.md)
- [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)
- [HARDWARE-POS.md](./HARDWARE-POS.md)
- [TESTING.md](./TESTING.md)
