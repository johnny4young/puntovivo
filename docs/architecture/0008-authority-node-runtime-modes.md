# 0008 - Authority Node Runtime Modes

> Status: Accepted
> Date: 2026-05-08
> Supersedes: none; amends ADR-0001 by making "local store authority" a runtime mode, not only a per-cashier-machine rule.

## Decision

Puntovivo will model operational truth through an **Authority Node**:
the runtime process that owns the SQLite write path for a site or
single cashier device.

The default Authority Node mode remains `device_local`, matching the
current Electron deployment: one cashier device runs Electron, embeds
Fastify in the main process, owns a local SQLite file, and emits outbox
rows from that file. A second supported mode, `site_hub`, will let one
machine in a store own the site SQLite file while other terminals run
as `hub_client` devices and send commands over LAN. A `hub_client` is
not an Authority Node; it does not write operational tables directly
and does not emit `sync_outbox` rows for the sale it requested. The hub
does that after accepting the command.

Runtime mode names are stable contract names:

```ts
type AuthorityMode = 'device_local' | 'site_hub' | 'hub_client';
```

The central server or cloud service remains downstream of Authority
Nodes. It consumes events/outbox payloads produced by whichever node was
authoritative for the operation. It is not required for local selling.

## Alternatives Rejected

- **Shared SQLite file on a network drive/NAS** - SQLite must have a
  single owning process for Puntovivo's hot POS path. Multi-writer
  access over SMB/NFS is a corruption and latency risk.
- **Cloud server as the only authority** - breaks the offline-first
  selling requirement and makes internet connectivity part of the sale
  critical path.
- **Peer-to-peer CRDT mesh between cashier terminals** - too much
  machinery for money, fiscal, cash and inventory flows, where conflicts
  require explicit policy and operator visibility.
- **Hub clients with offline satellite writes in v1** - useful later,
  but it introduces a second sync plane from terminal to hub. Initial
  hub support will fail closed when the hub is unavailable.
- **Separate codebase for hub before in-repo runtime support** - a
  future `puntovivo-store-hub` package is possible, but the first
  implementation should reuse `@puntovivo/server` and the existing
  migrations/outbox/application services.

## Implementation Impact

- Add a local runtime config resolver shared by Electron and standalone
  server. The config owns `authorityMode`, `hubUrl`, `bindHost`,
  `bindPort`, `siteId`, `deviceId`, and `allowedLanOrigins`.
- Keep `device_local` as the default when no config exists. Existing
  desktop installs must keep booting on loopback with no setup wizard.
- Extend device registration from `kind: 'desktop' | 'web'` toward
  role-aware metadata (`device_local`, `site_hub`, `hub_client`) without
  breaking existing rows.
- `site_hub` may bind to LAN, but only with explicit operator config.
  It owns the SQLite file; terminals never mount that file directly.
- `hub_client` points the renderer/tRPC client at `hubUrl` and must show
  hub reachability in the UI before the cashier starts a sale.
- Electron `hub_client` authentication crosses a narrow main/preload boundary:
  main owns the remote login, rotating refresh/CSRF pair, staff switch, and
  logout. Renderer `/api/*` traffic crosses the same fixed-destination boundary
  with allowlisted request headers, avoiding dynamic CSP or CORS expansion; the
  renderer owns only the short-lived access token. The renewable
  credential envelope is sealed with the OS keychain and stored mode `0600`
  where supported (per-user OS ACL on Windows). Packaged clients require HTTPS,
  with loopback HTTP permitted only in development.
- Realtime shares that access-session authority instead of minting a parallel
  cookie. Browser and local-authority clients use Authorization-capable
  streaming `fetch`; `hub_client` uses a narrow main-process relay fixed to
  `/api/realtime/subscribe`. Both paths share one incremental frame parser,
  replay the last event cursor, reconnect with bounded backoff, and terminate
  when periodic `sessionVersion` revalidation detects revocation.
- Peripherals physically attached to a `hub_client` terminal execute
  through a client-local hardware bridge after the hub authorizes the
  command or returns the printable payload. That bridge never writes
  operational tables and never becomes the Authority Node.
- Critical command envelopes continue to carry `deviceId`,
  `operationId`, `idempotencyKey`, `tenantId`, `siteId`, and `actorId`.
  The hub stores the caller device id for audit, journal, outbox and
  anomaly attribution.
- Sync/fiscal/hardware/webhook outboxes remain attached to the
  Authority Node. In `device_local`, that is the cashier device. In
  `site_hub`, that is the store hub.
- Central-server ingestion must read Authority Node outboxes/events. It
  must not read arbitrary POS tables or require every terminal to sync
  independently.

## Implementation map

- - Authority Node ADR + runtime config contract.
- - Device-local default hardening.
- - Store Hub server mode.
- - Hub Client mode.
- - Device pairing and authority health.
- - Satellite offline fallback spike.

Updated: 2026-07-22 - recorded authenticated, revocable Store Hub realtime.
