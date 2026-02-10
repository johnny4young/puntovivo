# tRPC Quick Start

## Fix Node Version Issue

The project requires Node.js v22 (as specified in `.nvmrc`). If you encounter build errors:

### Option 1: Use Node v22 (Recommended)
```bash
nvm use 22  # or: nvm install 22 && nvm use 22
rm -rf node_modules package-lock.json apps/*/node_modules packages/*/node_modules
npm install
```

### Option 2: Update to Your Node Version
```bash
echo "24" > .nvmrc  # or your current version
rm -rf node_modules package-lock.json apps/*/node_modules packages/*/node_modules
npm install
```

## Running the Server

### Option 1: Desktop App with Embedded Server (Full Experience)
```bash
# UPDATED: Now automatically starts both web and desktop!
npm run dev

# This will:
# 1. Start web dev server on port 3000
# 2. Wait 5 seconds for web to be ready
# 3. Start Electron desktop app with embedded server (port 8090)
# 4. Show login page (no more blank screen!)
```

**Fixed**: If you previously saw a blank screen with 404 errors, this is now resolved. The desktop app will properly load the web UI and show the login page.

For complete desktop setup details, see: **[docs/DESKTOP_APP_SETUP.md](./DESKTOP_APP_SETUP.md)**

### Option 2: Backend Server Only (For API Testing)
```bash
# Start just the backend server:
npm run dev:server

# Or start web + server together (no Electron):
npm run dev:fullstack
```

### Option 3: Desktop Only (If Web Already Running)
```bash
# If web dev server is already running on port 3000:
npm run dev:desktop-only
```

## Testing tRPC Endpoints

### Quick Test (curl)
```bash
# Once server is running (npm run dev:server or npm run dev):
curl http://localhost:8090/api/trpc/health.check

# Expected response:
# {"result":{"data":{"status":"ok","timestamp":"...","message":"tRPC is working correctly"}}}
```

**Note**: tRPC query procedures use GET requests (not POST). Mutation procedures use POST.

### Browser Test
Simply open in your browser:
```
http://localhost:8090/api/trpc/health.check
```

### Postman
1. Import collection: `postman/Open_Yojob_tRPC.postman_collection.json`
2. Send "Health Check" request
3. See docs/TRPC_TESTING_GUIDE.md for detailed instructions

### Automated Test Script
```bash
./scripts/test-trpc.sh
```

## Build Commands

```bash
# Build server only:
npm run build --workspace=@open-yojob/server

# Build web only:
npm run build:web

# Build everything (requires Electron deps):
npm run build
```

## More Information

- **Testing Guide**: `docs/TRPC_TESTING_GUIDE.md`
- **Implementation Plan**: `docs/TRPC_IMPLEMENTATION_PLAN.md`
- **Architecture**: `docs/TRPC_ARCHITECTURE_DIAGRAM.md`
