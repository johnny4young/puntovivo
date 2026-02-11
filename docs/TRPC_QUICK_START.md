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

## Running the Application

### Desktop App (Default)
```bash
npm run dev
```
Starts Electron desktop app with embedded server (port 8090).

**Note:** Desktop app expects web dev server on port 3000 in development. To run web + desktop together:
```bash
npm run dev:all
```

### Web Dev Server
```bash
npm run dev:web
```
Starts React dev server on port 3000 with hot reload.

### Backend Server Only
```bash
npm run dev:server
```
Starts Fastify server on port 8090 for API testing.

### Full Stack (Web + Server, No Desktop)
```bash
npm run dev:fullstack
```
Starts both web dev server and backend server concurrently.

## Testing tRPC Endpoints

### Quick Test (curl)
```bash
# Once server is running:
curl http://localhost:8090/api/trpc/health.check

# Expected response:
# {"result":{"data":{"status":"ok","timestamp":"...","message":"tRPC is working correctly"}}}
```

**Note**: tRPC query procedures use GET requests. Mutation procedures use POST.

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
# Build web only:
npm run build:web

# Build and package desktop app (includes web):
npm run build

# Package desktop app:
npm run make
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

### Common Issues

- **Desktop shows blank screen** → Ensure web dev server is running on port 3000, or use `npm run dev:all`
- **"METHOD_NOT_SUPPORTED" error** → Use GET for queries, POST for mutations
- **"Cannot connect"** → Check server is running and URL matches
- **Build failures** → Check Node v22 and run `npm install`

See complete troubleshooting guide: **[docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**

## More Information

- **Troubleshooting**: `docs/TROUBLESHOOTING.md`
- **Environment Config**: `docs/ENVIRONMENT_CONFIGURATION.md`
- **Testing Guide**: `docs/TRPC_TESTING_GUIDE.md`
- **Implementation Plan**: `docs/TRPC_IMPLEMENTATION_PLAN.md`
- **Architecture**: `docs/TRPC_ARCHITECTURE_DIAGRAM.md`
