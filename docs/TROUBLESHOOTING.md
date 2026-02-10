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

**Cause:** Dependencies are not installed.

**Solution:**

```bash
# Install all dependencies
npm install
```

**Verification:**
```bash
# Should work now
npm run dev:server

# Expected output:
# [Server] Server started at http://127.0.0.1:8090
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

**Solution:**

```bash
# Start web dev server and desktop together
npm run dev:all

# This starts:
# 1. Web dev server on port 3000
# 2. Wait 3 seconds
# 3. Desktop app with embedded server on port 8090
```

**Alternative: Manual start**
```bash
# Terminal 1: Start web dev server
npm run dev:web

# Terminal 2: Wait for web to be ready, then start desktop
npm run dev:desktop-only
```

---

## tRPC connection errors

### Issue: "METHOD_NOT_SUPPORTED" error

**Error:**
```json
{
  "error": {
    "message": "Unsupported POST-request to query procedure",
    "code": -32005
  }
}
```

**Cause:** Using wrong HTTP method for tRPC procedure type.

**Solution:**

tRPC uses different HTTP methods:
- **Query procedures** (`.query()`) use **GET** requests
- **Mutation procedures** (`.mutation()`) use **POST** requests

**Correct usage:**
```bash
# Health check is a query - use GET
curl http://localhost:8090/api/trpc/health.check
```

### Issue: "Cannot connect to server"

**Symptoms:**
- Web app shows connection errors
- API calls fail

**Checklist:**

1. **Verify server is running:**
```bash
curl http://localhost:8090/api/health
```

2. **Check server URL in apps/web/.env:**
```bash
VITE_API_URL=http://localhost:8090
```

3. **Restart if needed:**
```bash
npm run dev:server
```

---

## Build failures

### Issue: Node version mismatch

**Error:**
```bash
npm error Unsupported engine
```

**Cause:** Wrong Node.js version. Project requires Node v22.

**Solution:**

```bash
# Option 1: Use Node v22 (recommended)
nvm use 22
npm install

# Option 2: Update .nvmrc
echo "24" > .nvmrc
npm install
```

### Issue: Peer dependency conflict

**Solution:**

```bash
# Clean install
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

---

## Port already in use

### Issue: EADDRINUSE error

**Error:**
```bash
Error: listen EADDRINUSE: address already in use :::8090
```

**Solution:**

```bash
# Find and stop process using the port
lsof -i :8090

# Or use different port
PORT=3001 npm run dev:server
```

---

## Quick Fixes Checklist

1. Install dependencies: `npm install`
2. Check Node version: `node --version` (should be 22.x)
3. Verify server: `curl http://localhost:8090/api/health`
4. Clean install if needed: `rm -rf node_modules && npm install`

---

## More Resources

- **Quick Start**: `docs/TRPC_QUICK_START.md`
- **Environment Config**: `docs/ENVIRONMENT_CONFIGURATION.md`
- **Testing Guide**: `docs/TRPC_TESTING_GUIDE.md`
