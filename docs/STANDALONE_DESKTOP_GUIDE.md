# Standalone Desktop App Guide

## Overview

The Open Yojob desktop app can run in **three different modes**, giving you flexibility in how you develop and test:

| Mode                            | Web Source                       | Hot Reload | Web Dev Server Required | Use Case                 |
| ------------------------------- | -------------------------------- | ---------- | ----------------------- | ------------------------ |
| **Development with Hot Reload** | Dev server @ `localhost:3000`    | ✅ Yes     | ✅ Yes                  | Active UI development    |
| **Standalone**                  | Built files from `apps/web/dist` | ❌ No      | ❌ No                   | **Desktop-only testing** |
| **Production**                  | Packaged files                   | ❌ No      | ❌ No                   | Final packaged app       |

## Commands

### 1. Standalone Desktop App (No Web Dev Server) ⭐ RECOMMENDED

```bash
npm run dev:desktop-standalone
```

**What it does:**

1. Builds the web app (`apps/web/dist`)
2. Starts the Electron desktop app
3. Loads web UI from built files (not dev server)
4. Starts embedded Fastify server on port 8090

**When to use:**

- ✅ Testing desktop app functionality
- ✅ Working on backend/server features
- ✅ Don't need UI hot reload
- ✅ Want fastest startup (no web dev server)
- ✅ **Answer to: "I want to launch desktop without web dev server"**

**Requirements:**

- None! Just run the command

**Output:**

```
Building web app...
✓ Built in 4.00s

Starting desktop app...
[Electron] isPackaged: false, isDev: true
[Mode: Standalone Development] Loading from built files: .../apps/web/dist/index.html
[Server] ✓ Server started at http://127.0.0.1:8090
```

---

### 2. Development with Hot Reload

```bash
npm run dev
```

**What it does:**

1. Starts web dev server on port 3000 (with hot reload)
2. Waits 5 seconds for web server to be ready
3. Starts Electron desktop app
4. Loads web UI from `http://localhost:3000`
5. Starts embedded Fastify server on port 8090

**When to use:**

- ✅ Active UI development
- ✅ Need instant hot reload for React changes
- ✅ Want to see changes without rebuilding

**Requirements:**

- Port 3000 must be available

**Output:**

```
[WEB] VITE v5.x.x ready in xxx ms
[WEB] ➜ Local:   http://localhost:3000/

[DESKTOP] [Electron] isPackaged: false, isDev: true
[DESKTOP] [Mode: Dev with Hot Reload] Loading from dev server: http://localhost:3000
[DESKTOP] [Server] ✓ Server started at http://127.0.0.1:8090
```

---

### 3. Desktop Only (Assumes Web Server Already Running)

```bash
npm run dev:desktop-only
```

**What it does:**

1. Starts Electron desktop app only
2. Tries to load from `http://localhost:3000`
3. Starts embedded Fastify server on port 8090

**When to use:**

- ✅ Web dev server is already running in another terminal
- ✅ Restarting desktop app frequently
- ✅ Debugging desktop app specifically

**Requirements:**

- Web dev server must already be running on port 3000

**If web server is NOT running:**

- ❌ Blank screen with 404 error (same issue shown in screenshot)
- Use `npm run dev:desktop-standalone` instead

---

### File Structure in Standalone Mode

```
apps/
├── web/
│   └── dist/                    ← Built web app (created by npm run build:web)
│       ├── index.html
│       └── assets/
│           ├── index.css
│           └── index.js
└── desktop/
    └── .vite/
        └── build/
            └── index.cjs        ← Electron main process
                                  (loads from ../../../web/dist/)
```

---

## Rebuilding After Changes

### If you change UI code:

```bash
# Rebuild web app and restart desktop
npm run dev:desktop-standalone
```

The script automatically rebuilds the web app before starting.

### If you change server/backend code:

The server is embedded in the desktop app and rebuilt automatically by electron-forge. Just restart:

```bash
npm run dev:desktop-standalone
```

---

## Comparison Matrix

| Feature                 | `dev`      | `dev:desktop-standalone` | `dev:desktop-only`           |
| ----------------------- | ---------- | ------------------------ | ---------------------------- |
| Starts web dev server   | ✅ Yes     | ❌ No                    | ❌ No                        |
| Requires web dev server | ✅ Yes     | ❌ No                    | ✅ Yes (must run separately) |
| Hot reload for React    | ✅ Yes     | ❌ No                    | ✅ Yes (if server running)   |
| Fastest startup         | ❌ Slowest | ✅ Fastest               | ⚡ Fast                      |
| DevTools open           | ✅ Yes     | ✅ Yes                   | ✅ Yes                       |
| Embedded server         | ✅ Yes     | ✅ Yes                   | ✅ Yes                       |
| Standalone              | ❌ No      | ✅ **Yes**               | ❌ No                        |

---

## Troubleshooting

### Blank Screen / 404 Error

**Symptom:**

```json
{ "message": "Route GET:/ not found", "error": "Not Found", "statusCode": 404 }
```

**Cause:** Desktop app is trying to load from `http://localhost:3000` but web dev server isn't running.

**Solution:**

```bash
# Use standalone mode instead
npm run dev:desktop-standalone
```

### "Cannot find module" Errors

**Cause:** Web app not built yet.

**Solution:**

```bash
# Build web app first
npm run build:web

# Then start desktop
npm run dev:desktop-standalone
```

### Port 3000 Already in Use

If you get "EADDRINUSE" error:

```bash
# Option 1: Use standalone mode (doesn't need port 3000)
npm run dev:desktop-standalone

# Option 2: Kill process using port 3000
lsof -ti:3000 | xargs kill -9

# Then try again
npm run dev
```

---

## Which Command Should I Use?

### Use `npm run dev:desktop-standalone` if:

- ✅ You just want to test the desktop app
- ✅ You don't need UI hot reload
- ✅ You're working on server/backend features
- ✅ You want the simplest, fastest way to run the app
- ✅ **You want to avoid running a web dev server** ⭐

### Use `npm run dev` if:

- ✅ You're actively developing the UI
- ✅ You want to see React changes instantly
- ✅ You're working on frontend features
- ✅ You don't mind the extra dev server

### Use `npm run dev:desktop-only` if:

- ✅ You already have web dev server running
- ✅ You're restarting desktop frequently for debugging
- ✅ You want hot reload but manage servers separately

---

## Summary

**Question:** "Is it mandatory to start a web dev server before launching desktop app?"

**Answer:** **No!** Use `npm run dev:desktop-standalone` to launch the desktop app without any web dev server.

```bash
# No web dev server required! 🎉
npm run dev:desktop-standalone
```

This builds the web app once and serves it directly from the Electron app, giving you a standalone desktop experience.
