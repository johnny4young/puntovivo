# Environment Configuration Guide

This guide explains how to configure the tRPC API URL, server port, and other environment variables for Open Yojob.

## Quick Answer

**Q: Can we parametrize the URL and/or port?**  
**A: Yes!** Use environment variables.

## Configuration Files

### Web App (Frontend)

File: `apps/web/.env`

```bash
# Change the API server URL/port
VITE_API_URL=http://localhost:8090

# Other settings
VITE_ENABLE_OFFLINE=true
VITE_SYNC_INTERVAL=30000
VITE_APP_NAME=Open Yojob
```

### Server (Backend)

File: `.env` (root) or set in your shell

```bash
# Change the server port
PORT=8090

# Change the host (0.0.0.0 = all interfaces, 127.0.0.1 = localhost only)
HOST=127.0.0.1

# Database location
DATABASE_URL=./data/local.db

# JWT secret for authentication
JWT_SECRET=your-secret-key-here

# Enable verbose logging
VERBOSE=true
```

## Common Scenarios

### Scenario 1: Change Port to 3001

**Server side:**

```bash
# .env (root)
PORT=3001
```

**Web app side:**

```bash
# apps/web/.env
VITE_API_URL=http://localhost:3001
```

**Start server:**

```bash
npm run dev:server
# Server starts on http://localhost:3001
```

### Scenario 2: Connect to Remote Server

**Web app:**

```bash
# apps/web/.env
VITE_API_URL=https://api.example.com
```

**Rebuild web app to apply changes:**

```bash
npm run build:web
```

### Scenario 3: Desktop App with Custom Port

**Server configuration:**

```bash
# .env
PORT=9000
```

**Web app configuration:**

```bash
# apps/web/.env
VITE_API_URL=http://localhost:9000
```

**Run desktop shell only:**

```bash
npm run dev:desktop-only
```

### Scenario 4: Docker/Production Deployment

**Server:**

```bash
# .env
PORT=8090
HOST=0.0.0.0  # Accept connections from any interface
DATABASE_URL=/data/production.db
JWT_SECRET=your-secure-random-secret
VERBOSE=false
```

**Web app:**

```bash
# apps/web/.env
VITE_API_URL=https://your-domain.com
VITE_ENABLE_OFFLINE=true
```

## How It Works

### Frontend (tRPC Client)

The tRPC client URL is configured in `apps/web/src/main.tsx`:

```typescript
httpBatchLink({
  url: `${import.meta.env.VITE_API_URL || 'http://localhost:8090'}/api/trpc`,
  // ...
});
```

**Environment variable:** `VITE_API_URL`  
**Default:** `http://localhost:8090`  
**Rebuild required:** Yes (Vite bundles env vars at build time)

### Backend (Server)

The server port is configured in `packages/server/src/standalone.ts`:

```typescript
const port = parseInt(process.env.PORT || '8090', 10);
const host = process.env.HOST || '127.0.0.1';
```

**Environment variables:**

- `PORT` - Server port (default: 8090)
- `HOST` - Server host (default: 127.0.0.1)

**Rebuild required:** No (reads env vars at runtime)

## Testing Configuration

### Test Server Port Change

```bash
# Terminal 1: Start server on custom port
PORT=3001 npm run dev:server

# Should see:
# [Server] ✓ Server started at http://127.0.0.1:3001
```

### Test Web App URL Change

```bash
# Update apps/web/.env
echo "VITE_API_URL=http://localhost:3001" > apps/web/.env

# Rebuild web app
npm run build:web

# Run the Electron shell only
npm run dev:desktop-only
```

### Test with curl

```bash
# Health check on custom port
curl http://localhost:3001/api/health

# tRPC health check
curl http://localhost:3001/api/trpc/health.check
```

## Important Notes

### Web App Environment Variables

⚠️ **Vite environment variables are bundled at BUILD time**

This means:

1. Changes to `.env` require rebuilding the web app
2. Use `npm run build:web` or restart `npm run dev:web`
3. Variables are embedded in the JavaScript bundle

### Server Environment Variables

✅ **Server environment variables are read at RUNTIME**

This means:

1. No rebuild needed for server
2. Just restart the server process
3. Can be changed on the fly

### Desktop App

The desktop app embeds the server, so:

- Server env vars work as usual (runtime)
- Web app env vars require rebuild
- Use `dev:desktop-only` after changing web env vars

## Troubleshooting

### "Cannot connect to server"

1. Check server is running:

   ```bash
   curl http://localhost:8090/api/health
   ```

2. Check `VITE_API_URL` matches server port:

   ```bash
   # apps/web/.env
   VITE_API_URL=http://localhost:8090  # Must match server PORT
   ```

3. Rebuild web app if you changed .env:
   ```bash
   npm run build:web
   ```

### "PORT already in use"

Change the port:

```bash
# .env
PORT=8091  # Use different port

# Or in command:
PORT=8091 npm run dev:server
```

### Changes not taking effect

**For web app:**

```bash
# Rebuild required
npm run build:web
# Or restart dev server
npm run dev:web
```

**For server:**

```bash
# Just restart
npm run dev:server
```

## Default Values Summary

| Variable       | Location        | Default                 | Rebuild Required |
| -------------- | --------------- | ----------------------- | ---------------- |
| `VITE_API_URL` | `apps/web/.env` | `http://localhost:8090` | Yes (web)        |
| `PORT`         | `.env` (root)   | `8090`                  | No               |
| `HOST`         | `.env` (root)   | `127.0.0.1`             | No               |
| `DATABASE_URL` | `.env` (root)   | `./data/local.db`       | No               |
| `JWT_SECRET`   | `.env` (root)   | Auto-generated          | No               |
| `VERBOSE`      | `.env` (root)   | `false`                 | No               |

## Examples

### Development (default)

```bash
# No configuration needed
npm run dev:server  # Runs on :8090
npm run dev:web     # Connects to :8090
```

### Custom Port

```bash
# .env
PORT=3001

# apps/web/.env
VITE_API_URL=http://localhost:3001

npm run dev:server
npm run build:web
npm run dev:desktop-only
```

### Network Access

```bash
# .env
PORT=8090
HOST=0.0.0.0  # Accept from network

# apps/web/.env
VITE_API_URL=http://192.168.1.100:8090  # Your machine's IP

npm run dev:server
```

## See Also

- [TRPC_TESTING_GUIDE.md](./TRPC_TESTING_GUIDE.md) - Testing endpoints
- [LOGIN_GUIDE.md](./LOGIN_GUIDE.md) - Authentication guide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture

---

**Answer to comment**: Yes! The URL and port are fully configurable via environment variables. See scenarios above for examples.
