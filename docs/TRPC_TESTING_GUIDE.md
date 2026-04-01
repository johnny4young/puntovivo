# Testing tRPC Endpoints - Quick Guide

## Issue Resolution

### 1. Node.js Version Mismatch

**Problem**: You're running an incompatible Node.js version. The project requires Node v22+ (as specified in `package.json` engines).

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

#### Option B: Use the latest LTS

```bash
# If you prefer to use the latest LTS version (must be >= 22):
nvm install --lts
nvm use --lts

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

**Option A: Desktop App with Embedded Server (Full App)**

```bash
# Start the Electron desktop app (includes embedded server):
npm run dev

# Note: This requires all dependencies to be installed:
npm install  # Run this first if you haven't
```

**Option B: Backend Server Only (For API Testing)**

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

Once the server is running (`npm run dev:server` or `npm run dev`), test the health check endpoint:

```bash
# Health check endpoint (query procedures use GET)
curl http://localhost:8090/api/trpc/health.check

# Expected response:
# {"result":{"data":{"status":"ok","timestamp":"2026-02-10T...","message":"tRPC is working correctly"}}}
```

**Important**: tRPC query procedures (`.query()`) use GET requests, while mutation procedures (`.mutation()`) use POST requests.

### Method 2: Using Postman

1. **Start the server**: `npm run dev:server` or `npm run dev`

2. **Create a new GET request**:
   - **URL**: `http://localhost:8090/api/trpc/health.check`
   - **Method**: GET
   - **Headers**: None required for health check

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

### Method 3: Using Browser (Easy with GET requests)

Query procedures use GET requests, making browser testing straightforward:

1. **Start the server**: `npm run dev:server` or `npm run dev`

2. **Option A - Direct URL in browser**:
   - Open: `http://localhost:8090/api/trpc/health.check`
   - You should see the JSON response directly

3. **Option B - Browser DevTools Console**:

   ```javascript
   fetch('http://localhost:8090/api/trpc/health.check')
     .then(r => r.json())
     .then(console.log);
   ```

4. **Expected output in console**:
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
   # Or for desktop app with embedded server:
   npm run dev
   ```

2. **Open the web app**: `http://localhost:3000` (or the Electron window)

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

| Endpoint       | Type  | Auth Required | Description           |
| -------------- | ----- | ------------- | --------------------- |
| `health.check` | query | No            | Health check endpoint |

### Future Endpoints (Phase 2+):

Will include:

- `products.list` - List products (paginated) - **GET** (query)
- `products.getById` - Get single product - **GET** (query)
- `products.create` - Create product - **POST** (mutation)
- `products.update` - Update product - **POST** (mutation)
- `products.delete` - Delete product - **POST** (mutation)

**Key Difference:**

- **Query procedures** (`.query()`) use **GET** requests - for reading data
- **Mutation procedures** (`.mutation()`) use **POST** requests - for creating/updating/deleting data

---

## Authentication for Protected Endpoints

When testing authenticated endpoints (Phase 2+), include the JWT token:

### Using curl for queries (GET):

```bash
# List products (query = GET request)
curl http://localhost:8090/api/trpc/products.list?input=%7B%22page%22%3A1%2C%22perPage%22%3A50%7D \
  -H "Authorization: ******
```

### Using curl for mutations (POST):

```bash
# Create product (mutation = POST request)
curl -X POST http://localhost:8090/api/trpc/products.create \
  -H "Content-Type: application/json" \
  -H "Authorization: ******
  -d '{"name":"Product Name","price":100}'
```

### Using Postman:

1. Get the token from the login endpoint first:
   ```bash
   curl -X POST http://localhost:8090/api/auth/login \
     -H "Content-Type: application/json" \
      -d '{"email":"admin@localhost","password":"<your-generated-password>"}'
   ```
2. For **queries** (GET): Add header `Authorization: **\*\***
3. For **mutations** (POST): Add header `Authorization: **\*\***

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

# Test health check (query procedures use GET, not POST)
response=$(curl -s http://localhost:8090/api/trpc/health.check)

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
