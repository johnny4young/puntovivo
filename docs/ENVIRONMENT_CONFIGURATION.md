# Environment Configuration

> Updated: April 9, 2026

## Overview

Puntovivo reads configuration from two places:

- root `.env` for server and desktop-oriented runtime settings
- `apps/web/.env` for Vite-bundled web settings

Examples live in:

- [.env.example](/Users/johnny4young/Personal/github/puntovivo/.env.example)
- [apps/web/.env.example](/Users/johnny4young/Personal/github/puntovivo/apps/web/.env.example)

## Root Environment Variables

These affect the Fastify server, the embedded desktop runtime, or both.

### Server runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUNTOVIVO_AUTHORITY_MODE` | `device_local` | Authority Node mode per ADR-0008. One of `device_local`, `site_hub`, `hub_client`. Invalid values fail the boot. |
| `PUNTOVIVO_BIND_HOST` | `127.0.0.1` | Bind host for the embedded Fastify server. Takes precedence over `HOST`. |
| `PUNTOVIVO_BIND_PORT` | `8090` | Bind port for the embedded Fastify server. Takes precedence over `PORT`. |
| `PUNTOVIVO_HUB_URL` | unset | Hub URL when `PUNTOVIVO_AUTHORITY_MODE=hub_client`. Reserved for ENG-074 (the renderer plumbing lands there). |
| `PUNTOVIVO_SITE_ID` | unset | Operator-supplied site identifier; null falls back to a DB lookup. |
| `PUNTOVIVO_DEVICE_ID` | unset | Operator-supplied device identifier; null falls back to `device-id.txt`. |
| `PUNTOVIVO_ALLOWED_LAN_ORIGINS` | unset | Comma-separated CORS origins accepted in `site_hub` mode. Reserved for ENG-073. |
| `PORT` | `8090` | Legacy alias for `PUNTOVIVO_BIND_PORT`. Still honored when the new var is unset, so existing standalone deployments keep working without changes. |
| `HOST` | `127.0.0.1` | Legacy alias for `PUNTOVIVO_BIND_HOST`. Same compatibility note as `PORT`. |
| `DATABASE_URL` | internal default | SQLite database path for standalone mode |
| `JWT_SECRET` | generated at runtime in `device_local`; **REQUIRED strong secret** in `site_hub` | JWT signing secret. ENG-073 — site_hub mode refuses to boot unless this is an explicit 32+ character non-placeholder value with at least 8 unique characters, because auto-generated or weak secrets reset/break cashier sessions or weaken LAN tokens. See `docs/AUTHORITY-NODE.md` > Store Hub Mode. |
| `VERBOSE` | `false` unless explicitly enabled | Server logging |

The standalone server reads these via the shared resolver in:
[config/runtime.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/config/runtime.ts)
and the boot sites in [standalone.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/standalone.ts) +
[apps/desktop/src/main/index.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/main/index.ts).

### Desktop / Electron runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_DEV_SERVER_URL` | `http://localhost:3000` | Renderer URL in desktop development mode |
| `AUTO_UPDATE` | enabled unless set to `false` | Enables desktop auto-updater |
| `AUTO_UPDATE_INTERVAL` | `1 hour` | Auto-update polling interval |

Relevant files:

- [index.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/main/index.ts)
- [auto-updater.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/main/auto-updater.ts)

## Web Environment Variables

These are bundled by Vite and must be present as `VITE_*`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8090` | Base server URL used by the tRPC client |
| `VITE_ENABLE_OFFLINE` | `true` | UI/feature toggle for offline support |
| `VITE_SYNC_INTERVAL` | `30000` | Sync polling interval in browser mode |
| `VITE_APP_NAME` | `Puntovivo` | Display label |

Relevant file:
[trpc.ts](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/lib/trpc.ts)

## Common Setups

### Local desktop development

```bash
npm install
npx electron-rebuild -m apps/desktop
npm run dev:desktop
```

### Local web + standalone server

```bash
npm run dev:web-stack
```

### Custom backend port

```bash
# root .env
PORT=9000

# apps/web/.env
VITE_API_URL=http://localhost:9000
```

## Important Behavior

### Vite variables are build-time

Changes to `apps/web/.env` require restarting the web dev server or rebuilding the web bundle.

### Server variables are runtime

Changes to root/server variables only require restarting the relevant process.

### Desktop mode still uses embedded Fastify

In desktop mode, the backend is in-process inside Electron main.
The web bundle still needs the correct `VITE_API_URL` during renderer development and build.

## Verification

```bash
curl http://localhost:8090/api/health
curl http://localhost:8090/api/trpc/health.check
```

If you changed ports, update the URL accordingly.
