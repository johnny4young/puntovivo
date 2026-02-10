#!/bin/bash

# tRPC Quick Fix and Test Script
# This script fixes common issues and tests the tRPC endpoint

set -e

echo "=========================================="
echo "  tRPC Quick Fix and Test"
echo "=========================================="
echo ""

# Check Node version
echo "1. Checking Node.js version..."
NODE_VERSION=$(node --version)
echo "   Current Node version: $NODE_VERSION"

REQUIRED_VERSION=$(cat .nvmrc 2>/dev/null || echo "22")
echo "   Required version: v$REQUIRED_VERSION"

if [[ ! "$NODE_VERSION" =~ ^v$REQUIRED_VERSION\. ]]; then
    echo "   ⚠️  WARNING: Node version mismatch!"
    echo "   Please switch to Node v$REQUIRED_VERSION"
    echo ""
    echo "   Options:"
    echo "   A) Use nvm: nvm use $REQUIRED_VERSION"
    echo "   B) Update .nvmrc to match your version"
    echo ""
    read -p "   Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""

# Check if dependencies are installed
echo "2. Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo "   Installing dependencies..."
    npm install
else
    echo "   ✓ Dependencies found"
fi

echo ""

# Build the server
echo "3. Building server package..."
cd packages/server
if ! npm run build; then
    echo "   ❌ Server build failed"
    echo "   Try: npm install && npm run build"
    exit 1
fi
echo "   ✓ Server built successfully"
cd ../..

echo ""

# Start the server in background
echo "4. Starting tRPC server..."
cd packages/server
npm run dev > /tmp/trpc-server.log 2>&1 &
SERVER_PID=$!
cd ../..

echo "   Server PID: $SERVER_PID"
echo "   Waiting for server to start..."
sleep 5

# Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "   ❌ Server failed to start"
    echo "   Log:"
    tail -20 /tmp/trpc-server.log
    exit 1
fi

echo "   ✓ Server started"
echo ""

# Test the tRPC endpoint
echo "5. Testing tRPC endpoint..."
echo "   URL: http://localhost:8090/api/trpc/health.check"
echo ""

RESPONSE=$(curl -s -X POST http://localhost:8090/api/trpc/health.check \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null || echo "failed")

if [[ "$RESPONSE" == "failed" ]]; then
    echo "   ❌ Request failed. Is the server running?"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo "   Response:"
echo "   $RESPONSE" | jq '.' 2>/dev/null || echo "   $RESPONSE"
echo ""

# Check if response is valid
if [[ "$RESPONSE" == *"\"status\":\"ok\""* ]]; then
    echo "   ✅ tRPC is working correctly!"
else
    echo "   ⚠️  Unexpected response"
fi

echo ""
echo "=========================================="
echo "  Summary"
echo "=========================================="
echo ""
echo "Server is running at: http://localhost:8090"
echo "tRPC endpoint: http://localhost:8090/api/trpc"
echo "Server PID: $SERVER_PID"
echo ""
echo "To stop the server:"
echo "  kill $SERVER_PID"
echo ""
echo "To test other endpoints, see:"
echo "  docs/TRPC_TESTING_GUIDE.md"
echo ""

# Keep server running if requested
read -p "Keep server running? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo ""
    echo "Server is still running. Press Ctrl+C to stop."
    echo "Log file: /tmp/trpc-server.log"
    wait $SERVER_PID
else
    echo "Stopping server..."
    kill $SERVER_PID 2>/dev/null || true
    echo "Done!"
fi
