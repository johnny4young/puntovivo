# Puntovivo

Puntovivo is a local-first, fiscal-native POS for Latin American retail
operators. The first sellable wedge is Colombia retail for 1-10 site stores:
fast checkout, cash accountability, site-owned stock, auditability, fiscal
readiness, and offline local authority before cloud expansion.

The project is not a generic ERP, not a cloud-only suite, and not trying to
ship every vertical at once. Restaurant, KDS, AI, delivery, public API, and
hosted SaaS work exist as modules or roadmap lanes, but the production gate is
still retail POS sellability.

## Current Status

As of 2026-06-01:

| Stage                | Verdict | Why                                                                                                                                     |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Development demo     | Yes     | Demo tenant, POS, inventory, cash sessions, quotations, fiscal mock, AI, sync, receipt templates, and operations surfaces can be shown. |
| Private retail pilot | Not yet | Fiscal contingency, final fiscal receipt proof, and physical POS hardware need to close first.                                          |
| Production sale      | No      | Requires a DIAN-authorized provider path, legal XML retention proof, hardware validation, and payment-terminal policy.                  |

The go/no-go checklist lives in [docs/SELLABILITY.md](./docs/SELLABILITY.md),
which holds the MVP Colombia definition of done across the demo, pilot, and
production gates.

![Puntovivo architecture](./docs/architecture.svg)

## Product Boundaries

### In Scope Now

- Colombia retail POS foundation.
- Local SQLite authority with offline operation.
- Electron desktop and browser web targets sharing the same React app.
- Embedded Fastify + tRPC API, with the Electron desktop server running
  in-process in the main process.
- Tenant-scoped data model, role guards, audit logs, cash sessions,
  site-owned stock, and fiscal document foundations.
- Neutral Latin American Spanish and English UI.

### Parked Or Gated

- Real DIAN provider integration is gated on provider contract, credentials,
  certificate, and numbering resolution.
- Hardware printer, drawer, scanner, and terminal certification require a
  physical lab.
- Hosted SaaS, public demo tenants, tenant clone, and micro-storefronts depend
  on the hosted deployment substrate spike.
- Restaurant/KDS/services/pharmacy depth should move only when a pilot makes
  that vertical the wedge.

## Quick Start

### Prerequisites

- Node.js `>=24.0.0`
- pnpm `11.x` through Corepack or a matching local install

```bash
corepack enable
pnpm install
pnpm --filter @puntovivo/desktop run rebuild
./scripts/check-setup.sh
```

pnpm 11 blocks dependency build scripts unless they are allowlisted. The repo
allowlist lives in [pnpm-workspace.yaml](./pnpm-workspace.yaml) and covers the
runtime pieces Puntovivo needs: Electron, better-sqlite3-multiple-ciphers,
argon2, and esbuild. If install prints
`ERR_PNPM_IGNORED_BUILDS`, fix the allowlist or run `pnpm approve-builds`, then
install again.

## Development Commands

Run workspace commands from the repo root.

| Task                        | Command                      |
| --------------------------- | ---------------------------- |
| Desktop stack               | `pnpm run dev:desktop`       |
| Electron shell only         | `pnpm run dev:desktop-shell` |
| Web app only                | `pnpm run dev:web`           |
| Web + standalone backend    | `pnpm run dev:web-stack`     |
| Backend only                | `pnpm run dev:server`        |
| Stop dev-launcher processes | `pnpm run dev:stop`          |
| Web CI gate                 | `pnpm run ci:web`            |
| Server CI gate              | `pnpm run ci:server`         |
| Desktop CI gate             | `pnpm run ci:desktop`        |
| Web E2E                     | `pnpm run test:e2e:web`      |
| Electron E2E                | `pnpm run test:e2e:electron` |
| Desktop package build       | `pnpm run build:desktop`     |

Dev login:

- Email: `admin@localhost`
- Password in development: `Admin123!Dev`, unless
  `PUNTOVIVO_DEV_ADMIN_PASSWORD` was set before first seed.

Production first-run credentials are generated and shown once in the server
console. See [docs/LOGIN_GUIDE.md](./docs/LOGIN_GUIDE.md).

## Runtime Shape

| Layer    | Current choice                                 | Notes                                                                              |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Desktop  | Electron 42 + electron-builder packaging       | The cipher fork ships Electron 42 prebuilds; v43 still needs cross-platform proof. |
| Web      | React 19 + Vite 8 + TypeScript 6               | Browser target and Electron renderer share the app code.                           |
| API      | Fastify + tRPC 11                              | `/api/trpc` is the canonical application API.                                      |
| Database | SQLite through better-sqlite3-multiple-ciphers | SQLCipher path is wired; dev modes can share an encrypted DB.                      |
| ORM      | Drizzle                                        | Migrations are the single schema path.                                             |
| State    | TanStack Query + Zustand                       | Server state and local UI state are separated.                                     |
| Styling  | Tailwind CSS v4 + CVA                          | See [docs/STYLING.md](./docs/STYLING.md).                                          |
| Realtime | SSE                                            | `/api/realtime/*` remains for live updates.                                        |

The desktop app imports `@puntovivo/server` directly from the Electron main
process. Do not model it as a child server process.

## Native Runtime Notes

Electron and standalone Node use different native ABIs. After install, rebuild
Electron natives:

```bash
pnpm --filter @puntovivo/desktop run rebuild
```

If standalone server tests fail after desktop packaging with a
`NODE_MODULE_VERSION` mismatch, rebuild the Node-side binding:

```bash
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

The current desktop runtime is Electron `42.6.2`. Keep manual
`electron-rebuild` invocations aligned with `apps/desktop/package.json`.

## Documentation Map

Start at [docs/README.md](./docs/README.md). The short version:

- [docs/SELLABILITY.md](./docs/SELLABILITY.md): demo, pilot, production go/no-go.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md): current system shape.
- [docs/ENVIRONMENT_CONFIGURATION.md](./docs/ENVIRONMENT_CONFIGURATION.md): env var reference.
- [docs/DESKTOP_RUNTIME_GUIDE.md](./docs/DESKTOP_RUNTIME_GUIDE.md): Electron runtime details.
- [docs/SECURITY.md](./docs/SECURITY.md): auth, hardening, and audit policy.

## Verification Policy

Run the CI gate that matches the area touched:

| Area                                  | Command                      |
| ------------------------------------- | ---------------------------- |
| `apps/web` React or TypeScript        | `pnpm run ci:web`            |
| `packages/server` backend             | `pnpm run ci:server`         |
| `apps/desktop/src/main` Electron main | `pnpm run ci:desktop`        |
| Web E2E/login/sales/inventory flows   | `pnpm run test:e2e:web`      |
| Electron bootstrap/E2E                | `pnpm run test:e2e:electron` |

Any user-facing UI change also needs a live web or Electron smoke in addition
to tests.

## License

MIT License. See [LICENSE](./LICENSE).
