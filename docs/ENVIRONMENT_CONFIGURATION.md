# Environment Configuration

> Updated: April 9, 2026

## Overview

Open Yojob reads configuration from two places:

- root `.env` for server and desktop-oriented runtime settings
- `apps/web/.env` for Vite-bundled web settings

Examples live in:

- [.env.example](/Users/johnny4young/Personal/github/open_yojob/.env.example)
- [apps/web/.env.example](/Users/johnny4young/Personal/github/open_yojob/apps/web/.env.example)

## Root Environment Variables

These affect the Fastify server, the embedded desktop runtime, or both.

### Server runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8090` | Standalone server port |
| `HOST` | `127.0.0.1` | Standalone server bind host |
| `DATABASE_URL` | internal default | SQLite database path for standalone mode |
| `JWT_SECRET` | generated at runtime | JWT signing secret |
| `VERBOSE` | `false` unless explicitly enabled | Server logging |

The standalone server reads these in:
[standalone.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/standalone.ts)

### Desktop / Electron runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_DEV_SERVER_URL` | `http://localhost:3000` | Renderer URL in desktop development mode |
| `AUTO_UPDATE` | enabled unless set to `false` | Enables desktop auto-updater |
| `AUTO_UPDATE_INTERVAL` | `1 hour` | Auto-update polling interval |

Relevant files:

- [index.ts](/Users/johnny4young/Personal/github/open_yojob/apps/desktop/src/main/index.ts)
- [auto-updater.ts](/Users/johnny4young/Personal/github/open_yojob/apps/desktop/src/main/auto-updater.ts)

## Web Environment Variables

These are bundled by Vite and must be present as `VITE_*`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:8090` | Base server URL used by the tRPC client |
| `VITE_ENABLE_OFFLINE` | `true` | UI/feature toggle for offline support |
| `VITE_SYNC_INTERVAL` | `30000` | Sync polling interval in browser mode |
| `VITE_APP_NAME` | `Open Yojob` | Display label |

Relevant file:
[trpc.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/lib/trpc.ts)

## Common Setups

### Local desktop development

```bash
npm install
npx electron-rebuild -m apps/desktop
npm run dev
```

### Local web + standalone server

```bash
npm run dev:fullstack
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
