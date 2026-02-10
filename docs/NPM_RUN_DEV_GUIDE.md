# Getting npm run dev to Work

## Issue

The `npm run dev` command starts the Electron desktop app, which requires all Electron dependencies to be properly installed. If dependencies are missing, you'll see errors like:

```
sh: 1: electron-forge: not found
```

## Solution

### Step 1: Ensure Node Version is Correct

Check your Node version matches `.nvmrc`:

```bash
node --version  # Should be v22.x

# If not, use nvm:
nvm use 22
# or
nvm install 22 && nvm use 22
```

### Step 2: Clean Install All Dependencies

```bash
# From the project root:
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

This installs dependencies for:
- Root workspace
- `apps/desktop` (Electron app)
- `apps/web` (React frontend)
- `packages/server` (Fastify backend)

### Step 3: Run the Desktop App

```bash
npm run dev
```

This will:
1. Start the Electron desktop application
2. Embed the Fastify server inside the Electron process
3. Load the web frontend in an Electron window
4. Provide the full desktop app experience

## How It Works

The desktop app architecture:

```
Electron Main Process
  ├─ Embedded Fastify Server (port 8090)
  │   ├─ REST API endpoints (/api/*)
  │   └─ tRPC endpoints (/api/trpc/*)
  └─ Electron Window
      └─ React App (connects to localhost:8090)
```

When you run `npm run dev`:
1. Electron starts
2. `apps/desktop/src/index.ts` imports and starts the Fastify server
3. Server runs on `http://127.0.0.1:8090`
4. Electron window loads the web app (from `apps/web`)
5. Web app connects to the embedded server

## Alternative: Test Without Desktop App

If you don't need the full desktop experience and just want to test the API:

### Option 1: Server Only
```bash
npm run dev:server
# Test: curl http://localhost:8090/api/trpc/health.check
```

### Option 2: Web + Server (Two Separate Processes)
```bash
npm run dev:fullstack
# Opens browser at http://localhost:5173
```

### Option 3: Just Web
```bash
npm run dev:web
# Opens browser at http://localhost:5173
# Note: Requires server to be running separately
```

## Troubleshooting

### "electron-forge: not found"

**Problem**: Electron dependencies not installed in `apps/desktop/node_modules`

**Solution**:
```bash
cd apps/desktop
npm install
cd ../..
npm run dev
```

### "Cannot find module '@open-yojob/server'"

**Problem**: Server package not built or linked

**Solution**:
```bash
# Build the server package
npm run build --workspace=@open-yojob/server

# Then try again
npm run dev
```

### Port 8090 Already in Use

**Problem**: Another process is using port 8090

**Solution**:
```bash
# Find and kill the process
lsof -i :8090
kill -9 <PID>

# Or use a different port (modify server config)
```

### Build Errors

**Problem**: TypeScript compilation errors

**Solution**:
```bash
# Build server and web first
npm run build:web
npm run build --workspace=@open-yojob/server

# Then start desktop
npm run dev
```

## Dependencies Required for npm run dev

The desktop app needs these to run:

**Runtime Dependencies:**
- `electron` - Desktop framework
- `@electron-forge/cli` - Build and dev tools
- `@open-yojob/server` - Backend server package
- `react`, `react-dom` - UI framework
- All server dependencies (Fastify, Drizzle, SQLite, etc.)

**Total Install Size**: ~500MB (includes Electron binaries)

If you're only doing API development, consider using `npm run dev:server` instead to avoid installing Electron.

## Quick Reference

| Command | What It Does | Use When |
|---------|-------------|----------|
| `npm run dev` | Full desktop app | Testing complete app experience |
| `npm run dev:server` | Backend only | API development, tRPC testing |
| `npm run dev:web` | Frontend only | UI development |
| `npm run dev:fullstack` | Web + Server | Full-stack dev without Electron |

## Summary

To use `npm run dev`:
1. ✅ Ensure Node v22 (or update `.nvmrc`)
2. ✅ Run `npm install` from project root
3. ✅ All workspaces must have dependencies installed
4. ✅ Run `npm run dev`

The desktop app provides the complete experience with an embedded server, perfect for testing the full POS system as end users will use it.
