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

### Option 1: Desktop App - Standalone (No Web Dev Server) ⭐ **NEW!**
```bash
# Launches desktop app WITHOUT requiring a web dev server
npm run dev:desktop-standalone

# This will:
# 1. Build the web app (apps/web/dist)
# 2. Start Electron desktop with embedded server (port 8090)
# 3. Load UI from built files (not a dev server)
# 4. Show login page immediately
```

**Perfect for:**
- ✅ Testing desktop app without web dev server
- ✅ Fastest startup (no dev server overhead)
- ✅ Working on backend/server features
- ✅ **Answer to: "Can I run desktop without web dev server?"**

See complete guide: **[docs/STANDALONE_DESKTOP_GUIDE.md](./STANDALONE_DESKTOP_GUIDE.md)**

### Option 2: Desktop App with Hot Reload (Full Development)
```bash
# Starts both web dev server AND desktop app
npm run dev

# This will:
# 1. Start web dev server on port 3000 (with hot reload)
# 2. Wait 5 seconds for web to be ready
# 3. Start Electron desktop app with embedded server (port 8090)
# 4. Show login page with instant UI updates
```

**Perfect for:**
- ✅ Active UI development with hot reload
- ✅ Seeing React changes instantly

For complete desktop setup details, see: **[docs/DESKTOP_APP_SETUP.md](./DESKTOP_APP_SETUP.md)**

### Option 3: Backend Server Only (For API Testing)
```bash
# Start just the backend server:
npm run dev:server

# Or start web + server together (no Electron):
npm run dev:fullstack
```

### Option 4: Desktop Only (If Web Already Running)
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

## Configuration

### Change API URL/Port

See **[docs/ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md)** for complete guide.

**Quick example:**
```bash
# Change server port
echo "PORT=3001" >> .env

# Change web app URL
echo "VITE_API_URL=http://localhost:3001" > apps/web/.env

# Rebuild web and restart
npm run build:web
npm run dev:server
```

## Troubleshooting

### `npm run dev:server` fails with "tsx: not found"

**Solution:** Install dependencies
```bash
npm install
```

See complete troubleshooting guide: **[docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**

### Common Issues

- **Blank desktop screen** → Use `npm run dev:desktop-standalone`
- **"METHOD_NOT_SUPPORTED" error** → Use GET for queries, POST for mutations
- **"Cannot connect"** → Check server is running and URL matches
- **Build failures** → Check Node v22 and run `npm install`

## More Information

- **Troubleshooting**: `docs/TROUBLESHOOTING.md` ⭐ **NEW**
- **Environment Config**: `docs/ENVIRONMENT_CONFIGURATION.md` ⭐ **NEW**
- **Standalone Desktop**: `docs/STANDALONE_DESKTOP_GUIDE.md`
- **Desktop Setup**: `docs/DESKTOP_APP_SETUP.md`
- **Testing Guide**: `docs/TRPC_TESTING_GUIDE.md`
- **Implementation Plan**: `docs/TRPC_IMPLEMENTATION_PLAN.md`
- **Architecture**: `docs/TRPC_ARCHITECTURE_DIAGRAM.md`
