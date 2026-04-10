# Troubleshooting

> Updated: April 9, 2026

## 1. Native module mismatch

### Symptoms

- `NODE_MODULE_VERSION mismatch`
- `better-sqlite3` fails in Electron
- `argon2` fails when starting the desktop app

### Fix

```bash
npx electron-rebuild -m apps/desktop
```

If server tests later fail because `better-sqlite3` is now compiled for Electron instead of Node:

```bash
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

## 2. Desktop opens with blank or broken UI

### Check

The renderer dev server may not be running in development mode.

### Fix

```bash
npm run dev
```

Or start manually:

```bash
npm run dev:web
npm run dev:desktop-only
```

## 3. Web app cannot reach the backend

### Check

```bash
curl http://localhost:8090/api/health
```

### Fix

- verify the standalone server is running with `npm run dev:server`
- verify `VITE_API_URL` matches the server port
- restart the web dev server after changing `apps/web/.env`

## 4. tRPC request confusion

The canonical app API is `/api/trpc`, not legacy REST routes.

Use:

```bash
curl http://localhost:8090/api/trpc/health.check
```

`/api/health` is only a compatibility endpoint.

## 5. Port already in use

```bash
lsof -i :8090
lsof -i :3000
```

Then stop the conflicting process or change the configured port.

## 6. Desktop debug scripts not found at repo root

Root scripts are the combined app scripts.
Desktop-specific debug scripts live in the desktop workspace:

```bash
npm run dev:debug --workspace=@open-yojob/desktop
npm run dev:debug-brk --workspace=@open-yojob/desktop
```

## 7. Web build fails with chunk warnings

Large Vite chunk warnings are currently known and do not automatically mean the build failed.
Treat them as a performance follow-up unless `vite build` exits non-zero.

## 8. Login fails

Check:

- seeded email is `admin@localhost`
- in development/non-production, try `Admin123!Dev` unless you overrode `OPEN_YOJOB_DEV_ADMIN_PASSWORD`
- in production, copy the generated password from first-run output
- the tenant and user are active

See:
[LOGIN_GUIDE.md](/Users/johnny4young/Personal/github/open_yojob/docs/LOGIN_GUIDE.md)

## 9. Sync behavior looks stale

Check:

- current tenant is selected
- current site is selected where required
- pending queue/conflicts in the company sync center
- browser or desktop offline state

If needed, use the sync center in the Company page to:

- pull a fresh snapshot
- process the queue
- resolve conflicts

## 10. Fast fixes checklist

```bash
node --version
npm install
npx electron-rebuild -m apps/desktop
curl http://localhost:8090/api/health
npm run test --workspace=@open-yojob/web -- --run
```
