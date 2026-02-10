# Troubleshooting Guide

Common issues and solutions for Open Yojob development.

## Table of Contents

1. [npm run dev:server fails](#npm-run-devserver-fails)
2. [Desktop app shows blank screen](#desktop-app-shows-blank-screen)
3. [tRPC connection errors](#trpc-connection-errors)
4. [Build failures](#build-failures)
5. [Port already in use](#port-already-in-use)

---

## npm run dev:server fails

### Issue: "tsx: not found"

**Error:**
```bash
$ npm run dev:server
sh: 1: tsx: not found
npm error Lifecycle script `dev` failed with error:
npm error code 127
```

**Cause:** Dependencies are not installed in the server package.

**Solution:**

```bash
# Option 1: Install all dependencies from root (RECOMMENDED)
npm install

# Option 2: Install server dependencies only
npm install --workspace=@open-yojob/server

# Option 3: Install from server directory
cd packages/server
npm install
cd ../..
```

**Verification:**
```bash
# Should work now
npm run dev:server

# Expected output:
# ==========================================
#   Open Yojob Server - Standalone Mode
# ==========================================
#
# [Server] ✓ Server started at http://127.0.0.1:8090
```

### Issue: "Cannot find module"

**Error:**
```bash
Error: Cannot find module 'fastify'
```

**Cause:** Missing dependencies or corrupted node_modules.

**Solution:**
```bash
# Clean install
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

---

## Desktop app shows blank screen

### Issue: "Route GET:/ not found" (404 error)

**Symptoms:**
- Desktop app window opens but shows blank screen
- DevTools console shows: `{"message":"Route GET:/ not found","error":"Not Found","statusCode":404}`

**Cause:** Desktop app trying to load from web dev server that isn't running.

**Solutions:**

**Option 1: Use Standalone Mode (Recommended)**
```bash
# Builds web app and runs desktop without dev server
npm run dev:desktop-standalone
```

**Option 2: Run with Web Dev Server**
```bash
# Starts both web dev server and desktop app
npm run dev
```

**Option 3: Start Web Dev Server First**
```bash
# Terminal 1
npm run dev:web

# Terminal 2 (wait 5 seconds for web server to start)
npm run dev:desktop-only
```

See [STANDALONE_DESKTOP_GUIDE.md](./STANDALONE_DESKTOP_GUIDE.md) for details.

### Issue: Desktop app won't start

**Error:**
```bash
Error: Failed to load native module
```

**Cause:** Native modules (like better-sqlite3) not compiled for Electron.

**Solution:**
```bash
# Rebuild native modules for Electron
cd apps/desktop
npm run rebuild

# Or with electron-rebuild directly
npx electron-rebuild -f -v 40.1.0

cd ../..
```

**Permanent fix:** The `postinstall` script should handle this automatically:
```json
// apps/desktop/package.json
{
  "scripts": {
    "postinstall": "electron-rebuild -f -v 40.1.0"
  }
}
```

---

## tRPC Connection Errors

### Issue: "METHOD_NOT_SUPPORTED" error

**Error:**
```bash
$ curl -X POST http://localhost:8090/api/trpc/health.check
{"error":{"message":"Unsupported POST-request to query procedure at path \"health.check\"","code":-32005}}
```

**Cause:** Using wrong HTTP method. tRPC procedures have specific methods:
- Query procedures → **GET requests**
- Mutation procedures → **POST requests**

**Solution:**
```bash
# Correct: Use GET for query procedures
curl http://localhost:8090/api/trpc/health.check

# Or in browser:
http://localhost:8090/api/trpc/health.check
```

See [TRPC_TESTING_GUIDE.md](./TRPC_TESTING_GUIDE.md) for more examples.

### Issue: "Failed to fetch" or "Network Error"

**Symptoms:**
- Browser console: `TypeError: Failed to fetch`
- Desktop app can't connect to server

**Cause:** Server not running or wrong URL/port.

**Solutions:**

1. **Check server is running:**
   ```bash
   # Start server
   npm run dev:server
   
   # Test connection
   curl http://localhost:8090/api/health
   ```

2. **Check URL configuration:**
   ```bash
   # apps/web/.env
   VITE_API_URL=http://localhost:8090  # Must match server port
   ```

3. **Rebuild web app if you changed .env:**
   ```bash
   npm run build:web
   ```

See [ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md) for URL/port configuration.

---

## Build Failures

### Issue: "Cannot find module '@trpc/server'"

**Error:**
```bash
Error: Cannot find module '@trpc/server'
```

**Cause:** Missing dependencies after pulling latest changes.

**Solution:**
```bash
npm install
```

### Issue: Node version mismatch

**Error:**
```bash
error: The engine "node" is incompatible with this module.
```

**Cause:** Wrong Node.js version. Project requires Node v22.

**Solution:**
```bash
# Check current version
node --version

# Switch to Node v22
nvm use 22

# Or install Node v22 first
nvm install 22
nvm use 22

# Then install dependencies
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

### Issue: TypeScript compilation errors

**Error:**
```bash
error TS2304: Cannot find name 'RequestContext'
```

**Cause:** Missing type definitions or stale build cache.

**Solution:**
```bash
# Clean TypeScript build info
find . -name "tsconfig.tsbuildinfo" -delete

# Rebuild
npm run build:web
```

---

## Port Already in Use

### Issue: "EADDRINUSE: address already in use :::8090"

**Error:**
```bash
Error: listen EADDRINUSE: address already in use :::8090
```

**Cause:** Another process is using port 8090.

**Solutions:**

**Option 1: Kill the process using port 8090**
```bash
# Find process using port 8090
lsof -ti:8090

# Kill it
kill -9 $(lsof -ti:8090)

# Or on Windows:
netstat -ano | findstr :8090
taskkill /PID <PID> /F
```

**Option 2: Use a different port**
```bash
# .env
PORT=8091

# apps/web/.env
VITE_API_URL=http://localhost:8091

# Rebuild web and restart
npm run build:web
npm run dev:server
```

See [ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md) for port configuration.

---

## Dependencies Issues

### Issue: "Cannot find package 'cross-env'"

**Error:**
```bash
npm error Missing script: "dev:desktop-standalone"
```

**Cause:** Missing `cross-env` dependency.

**Solution:**
```bash
# Install from root
npm install

# Or install cross-env specifically
npm install --save-dev cross-env
```

### Issue: Workspace dependency errors

**Error:**
```bash
npm error Could not resolve dependency:
npm error peer @open-yojob/server@* from...
```

**Cause:** Workspace dependencies not properly linked.

**Solution:**
```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

---

## Quick Fixes Checklist

When something doesn't work, try these in order:

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Check Node version:**
   ```bash
   node --version  # Should be v22.x
   nvm use 22
   ```

3. **Clean rebuild:**
   ```bash
   rm -rf node_modules package-lock.json
   rm -rf apps/*/node_modules packages/*/node_modules
   npm install
   ```

4. **Rebuild native modules (desktop only):**
   ```bash
   cd apps/desktop && npm run rebuild && cd ../..
   ```

5. **Rebuild web app:**
   ```bash
   npm run build:web
   ```

6. **Check server is running:**
   ```bash
   curl http://localhost:8090/api/health
   ```

---

## Getting Help

If you're still stuck:

1. **Check documentation:**
   - [README.md](../README.md) - Getting started
   - [TRPC_QUICK_START.md](./TRPC_QUICK_START.md) - Quick reference
   - [ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md) - Configuration
   - [STANDALONE_DESKTOP_GUIDE.md](./STANDALONE_DESKTOP_GUIDE.md) - Desktop modes

2. **Enable verbose logging:**
   ```bash
   # .env
   VERBOSE=true
   
   npm run dev:server
   ```

3. **Check logs:**
   - Server logs: Terminal running `npm run dev:server`
   - Desktop logs: Electron DevTools console (Cmd+Option+I / Ctrl+Shift+I)
   - Web logs: Browser DevTools console (F12)

4. **Create an issue:**
   - Include error messages
   - Include steps to reproduce
   - Include your Node.js version (`node --version`)
   - Include your OS

---

**Quick Answer Summary:**

- **`npm run dev:server` fails?** → Run `npm install`
- **Blank desktop screen?** → Use `npm run dev:desktop-standalone`
- **tRPC errors?** → Check HTTP method (GET for queries, POST for mutations)
- **Can't configure URL/port?** → See [ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md)
- **Build failures?** → Check Node version (v22) and run `npm install`
