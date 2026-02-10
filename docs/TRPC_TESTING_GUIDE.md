# Testing tRPC Endpoints - Quick Guide

## Issue Resolution

### 1. Node.js Version Mismatch

**Problem**: You're running Node v24.x but the project requires Node v22 (as specified in `.nvmrc`).

**Solution Options**:

#### Option A: Use Node v22 (Recommended)
```bash
# If you have nvm installed:
nvm use 22
# or
nvm install 22
nvm use 22

# Then reinstall dependencies:
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

#### Option B: Update .nvmrc to v24
```bash
# If you prefer to use Node v24:
echo "24" > .nvmrc

# Then reinstall dependencies:
rm -rf node_modules package-lock.json  
rm -rf apps/*/node_modules packages/*/node_modules
npm install
```

### 2. Build Command Fix

After fixing the Node version:
```bash
# Build just the web app:
npm run build:web

# Or build everything:
npm run build
```

### 3. Running the Dev Server

The default `npm run dev` tries to start the Electron desktop app. To test tRPC, you need the **backend server**:

```bash
# Start just the backend server (recommended for tRPC testing):
npm run dev:server

# Or start both web and server:
npm run dev:fullstack

# Or start just the web app:
npm run dev:web
```

---

## Testing tRPC Endpoints

### Method 1: Using curl (Command Line)

Once the server is running (`npm run dev:server`), test the health check endpoint:

```bash
# Health check endpoint
curl -X POST http://localhost:8090/api/trpc/health.check \
  -H "Content-Type: application/json" \
  -d '{}'

# Expected response:
# {"result":{"data":{"status":"ok","timestamp":"2026-02-10T...","message":"tRPC is working correctly"}}}
```

### Method 2: Using Postman

1. **Start the server**: `npm run dev:server`

2. **Create a new POST request**:
   - **URL**: `http://localhost:8090/api/trpc/health.check`
   - **Method**: POST
   - **Headers**: 
     - `Content-Type: application/json`
   - **Body** (raw JSON):
     ```json
     {}
     ```

3. **Send the request**

4. **Expected Response** (200 OK):
   ```json
   {
     "result": {
       "data": {
         "status": "ok",
         "timestamp": "2026-02-10T19:35:00.000Z",
         "message": "tRPC is working correctly"
       }
     }
   }
   ```

### Method 3: Using Browser (Limited)

tRPC uses POST requests by default, so direct browser testing is limited. However, you can:

1. **Start the server**: `npm run dev:server`

2. **Open browser DevTools Console** and run:
   ```javascript
   fetch('http://localhost:8090/api/trpc/health.check', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: '{}'
   })
   .then(r => r.json())
   .then(console.log)
   ```

3. **Expected output in console**:
   ```javascript
   {
     result: {
       data: {
         status: "ok",
         timestamp: "2026-02-10T19:35:00.000Z",
         message: "tRPC is working correctly"
       }
     }
   }
   ```

### Method 4: Using the Web App (Best for full testing)

1. **Start both server and web**:
   ```bash
   npm run dev:fullstack
   ```

2. **Open the web app**: `http://localhost:5173`

3. **Open browser DevTools Console** and test:
   ```javascript
   // The trpc client is already configured in the app
   // You can test it from the console if you expose it
   // Or check Network tab for tRPC calls when using the app
   ```

---

## tRPC Endpoint Structure

All tRPC endpoints follow this pattern:

```
POST http://localhost:8090/api/trpc/<router>.<procedure>
```

### Available Endpoints (Phase 1):

| Endpoint | Type | Auth Required | Description |
|----------|------|---------------|-------------|
| `health.check` | query | No | Health check endpoint |

### Future Endpoints (Phase 2+):

Will include:
- `products.list` - List products (paginated)
- `products.getById` - Get single product
- `products.create` - Create product
- `products.update` - Update product
- `products.delete` - Delete product

---

## Authentication for Protected Endpoints

When testing authenticated endpoints (Phase 2+), include the JWT token:

### Using curl:
```bash
curl -X POST http://localhost:8090/api/trpc/products.list \
  -H "Content-Type: application/json" \
  -H "Authorization: ******
  -d '{"page":1,"perPage":50}'
```

### Using Postman:
1. Add header: `Authorization: ******
2. Get the token from the login endpoint first:
   ```bash
   curl -X POST http://localhost:8090/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@localhost","password":"admin123"}'
   ```

---

## Troubleshooting

### Server won't start
```bash
# Check if port 8090 is already in use:
lsof -i :8090
# or
netstat -an | grep 8090

# Kill the process if needed:
kill -9 <PID>
```

### Dependencies missing
```bash
# Reinstall all dependencies:
npm install

# Or clean install:
rm -rf node_modules package-lock.json
rm -rf apps/*/node_modules packages/*/node_modules  
npm install
```

### Build errors
```bash
# Ensure correct Node version:
node --version  # Should match .nvmrc (22.x)

# Clean and rebuild:
npm run clean
npm install
npm run build:web
```

---

## Quick Test Script

Save this as `test-trpc.sh`:

```bash
#!/bin/bash

echo "Testing tRPC endpoint..."
echo ""

# Test health check
response=$(curl -s -X POST http://localhost:8090/api/trpc/health.check \
  -H "Content-Type: application/json" \
  -d '{}')

echo "Response:"
echo $response | jq '.' 2>/dev/null || echo $response

echo ""
echo "If you see a status 'ok', tRPC is working!"
```

Make it executable and run:
```bash
chmod +x test-trpc.sh
./test-trpc.sh
```

---

## Next Steps

After confirming tRPC works:

1. **Phase 2**: Implement Products collection with full CRUD
2. **Phase 3**: Migrate remaining collections
3. **Phase 4**: Optimize and remove legacy code

See `docs/TRPC_IMPLEMENTATION_PLAN.md` for details.
