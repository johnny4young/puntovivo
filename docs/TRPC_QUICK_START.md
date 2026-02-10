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

The default `npm run dev` starts the Electron desktop app. To test tRPC:

```bash
# Start just the backend server:
npm run dev:server

# Or start web + server together:
npm run dev:fullstack
```

## Testing tRPC Endpoints

### Quick Test (curl)
```bash
# Once server is running (npm run dev:server):
curl -X POST http://localhost:8090/api/trpc/health.check \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected response:
# {"result":{"data":{"status":"ok","timestamp":"...","message":"tRPC is working correctly"}}}
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
