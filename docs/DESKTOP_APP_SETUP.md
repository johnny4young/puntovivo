# Desktop App Setup Guide

## Problem: Blank Screen When Running `npm run dev`

If you see a blank screen with a 404 error like:
```
{"message":"Route GET:/ not found","error":"Not Found","statusCode":404}
```

**Root Cause**: The desktop app (Electron) is trying to load the web app from `http://localhost:3000`, but the web dev server isn't running.

## Solution 1: Use the Fixed `npm run dev` Command (Recommended)

We've updated `npm run dev` to automatically start both the web app and desktop app together:

```bash
# This now starts BOTH web app (port 3000) and desktop app
npm run dev
```

This will:
1. Start the web app dev server on `http://localhost:3000`
2. Wait 5 seconds for the web server to be ready
3. Start the Electron desktop app, which loads the web app
4. Start the embedded Fastify server on `http://localhost:8090`

### What You'll See

When the desktop app loads correctly, you should see:
- **Login Page** - The Open Yojob login screen
- **No 404 errors** in the console
- **DevTools open** automatically in development mode

## Solution 2: Manual Start (Alternative)

If you prefer to start components separately:

```bash
# Terminal 1: Start web app
npm run dev:web

# Terminal 2: Wait for web to be ready (about 5 seconds), then start desktop
npm run dev:desktop-only
```

## Solution 3: Start Just Desktop (If Web is Already Built)

If the web app is already built (`apps/web/dist` exists):

```bash
npm run dev:desktop-only
```

The desktop app will load the pre-built web app instead of the dev server.

## Automated Electron Rebuild

We've added a `postinstall` script that automatically rebuilds native Electron modules after `npm install`:

```json
// apps/desktop/package.json
{
  "scripts": {
    "postinstall": "electron-rebuild -f -v 40.1.0"
  }
}
```

This ensures native modules (like better-sqlite3) are compatible with the Electron version.

### Manual Rebuild

If you need to rebuild manually:

```bash
# From root
npm run rebuild --workspace=@open-yojob/desktop

# Or from apps/desktop
cd apps/desktop
npm run rebuild
```

## Available Commands Reference

| Command | What It Does | Use When |
|---------|--------------|----------|
| `npm run dev` | Starts web + desktop together | **Main development** |
| `npm run dev:web` | Web app only (port 3000) | Testing web independently |
| `npm run dev:desktop-only` | Desktop app only | Web already running |
| `npm run dev:server` | Backend API only (port 8090) | Testing API endpoints |
| `npm run dev:fullstack` | Web + Server (no Electron) | Browser-based development |

## Architecture: How Desktop App Works

```
┌─────────────────────────────────────────┐
│   Electron Desktop App (npm run dev)   │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   Main Process (Node.js)          │ │
│  │   - Starts embedded Fastify server│ │
│  │   - Port 8090                     │ │
│  │   - Loads web content             │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   Renderer Process (Browser)      │ │
│  │   Loads from:                     │ │
│  │   - Dev: http://localhost:3000    │ │
│  │   - Prod: file://dist/index.html  │ │
│  └───────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### Development Mode
- Renderer loads from: `http://localhost:3000` (Vite dev server)
- Requires web app to be running
- Hot reload enabled
- DevTools open automatically

### Production Mode
- Renderer loads from: `file://resources/dist/index.html`
- Web app bundled inside the Electron app
- No external dependencies needed

## Troubleshooting

### Issue: "Cannot find module 'better-sqlite3'"

**Solution**: Run electron-rebuild
```bash
cd apps/desktop
npm run rebuild
```

Or reinstall to trigger postinstall:
```bash
npm install
```

### Issue: Web app loads but shows "Network Error"

**Problem**: Embedded server isn't starting

**Check**:
1. Look for server logs in terminal: `[Server] ✓ Server started at http://127.0.0.1:8090`
2. Test server directly: `curl http://localhost:8090/api/trpc/health.check`

**Solution**:
```bash
# Clean and rebuild
npm run clean --workspace=@open-yojob/desktop
npm install
npm run dev
```

### Issue: Port 3000 Already in Use

**Solution**: Kill the process using port 3000
```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Or change the port in apps/web/vite.config.ts
# server: { port: 3001 }
```

### Issue: Desktop app opens but immediately closes

**Problem**: Likely a crash in main process

**Solution**: Run with debug logging
```bash
npm run dev:debug --workspace=@open-yojob/desktop
```

Check the terminal for error messages.

### Issue: Changes to code not reflected

**For web code changes**:
- Web dev server has hot reload, changes should appear immediately
- If not, check that web dev server is running in terminal

**For desktop code changes** (main process):
- Must restart the desktop app
- Press Ctrl+C in terminal, then run `npm run dev` again

**For backend code changes**:
- Must restart the desktop app (embedded server restarts)
- Or use `npm run dev:server` separately with watch mode

## Login Page Not Showing

If the desktop app opens but you still don't see the login page:

1. **Check DevTools Console**
   - DevTools should open automatically in dev mode
   - Look for JavaScript errors
   - Check Network tab for failed requests

2. **Verify Web App is Running**
   ```bash
   # Open in regular browser
   open http://localhost:3000
   ```
   You should see the login page.

3. **Check Web App Routes**
   - Login page is at: `http://localhost:3000/login`
   - Desktop app should redirect there automatically if not authenticated

4. **Verify API Connection**
   ```bash
   # Test embedded server
   curl http://localhost:8090/api/trpc/health.check
   ```

## Complete Setup from Scratch

If you're setting up for the first time:

```bash
# 1. Ensure correct Node version
nvm use 22  # or: echo "22" > .nvmrc && nvm use

# 2. Clean install
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm install

# 3. Build web app (optional, for testing production mode)
npm run build:web

# 4. Start development
npm run dev
```

This will:
- Install all dependencies
- Automatically run electron-rebuild (via postinstall)
- Start both web and desktop together

## Next Steps

Once the desktop app is running with the login page:
- Default credentials are typically set in the seed data
- Check `packages/server/src/seed.ts` for initial users
- Or check the project documentation for test credentials

## Related Documentation

- `docs/NPM_RUN_DEV_GUIDE.md` - Original guide (now superseded by this doc)
- `docs/TRPC_TESTING_GUIDE.md` - Testing the embedded API server
- `apps/desktop/DEBUGGING.md` - Advanced debugging techniques
