#!/bin/bash
# Quick setup verification script for Puntovivo

echo "======================================"
echo "  Puntovivo - Setup Verification"
echo "======================================"
echo ""

# Check Node.js version
echo "Checking Node.js version..."
NODE_VERSION=$(node -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✓ Node.js: $NODE_VERSION"
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$MAJOR_VERSION" -lt 24 ]; then
        echo "⚠ Warning: Node.js 24+ is required (you have $NODE_VERSION)"
    fi
else
    echo "✗ Node.js not found. Please install Node.js 24+"
    exit 1
fi

# Check pnpm version (this repo migrated from npm to pnpm)
echo "Checking pnpm version..."
PNPM_VERSION=$(pnpm -v 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "✓ pnpm: $PNPM_VERSION"
else
    echo "✗ pnpm not found. Enable it with: corepack enable"
    exit 1
fi

echo ""
echo "Checking if dependencies are installed..."
if [ -d "node_modules" ]; then
    echo "✓ Dependencies installed"
else
    echo "✗ Dependencies not installed. Run: pnpm install"
    exit 1
fi

echo ""
echo "======================================"
echo "  Checking Postinstall Artefacts"
echo "======================================"
echo ""

# pnpm 11 blocks dependency build scripts by default; the needed natives
# are allowlisted in pnpm-workspace.yaml under `allowBuilds:`. A global
# ~/.npmrc with `ignore-scripts=true` is also honoured by pnpm and skips
# the repo's own packages' postinstalls — the project .npmrc sets
# `ignore-scripts=false` to override. Double-check that the artefacts are
# on disk so later `pnpm run dev:desktop` doesn't crash at
# `require('electron')` or with `NODE_MODULE_VERSION mismatch`.

GLOBAL_IGNORE=$(pnpm config get ignore-scripts --global 2>/dev/null || echo "")
PROJECT_IGNORE=$(pnpm config get ignore-scripts 2>/dev/null || echo "")
if [ "$GLOBAL_IGNORE" = "true" ] && [ "$PROJECT_IGNORE" != "false" ]; then
    echo "⚠ Your global ~/.npmrc has ignore-scripts=true and this repo's"
    echo "   .npmrc override is not being picked up."
    echo "   Re-run: pnpm install (and check pnpm-workspace.yaml allowBuilds)"
fi

# Electron runtime binary — populated by node_modules/electron/install.js
# as a postinstall step. Missing means the download was skipped or failed
# and `pnpm run dev:desktop` will crash at "Electron failed to install correctly".
if [ -f "node_modules/electron/path.txt" ] || [ -f "apps/desktop/node_modules/electron/path.txt" ]; then
    echo "✓ Electron runtime installed (node_modules/electron/path.txt)"
else
    echo "✗ Electron runtime binary missing."
    echo "  Auto-repair:   node scripts/ensure-electron-binary.mjs"
    echo "  Nuclear:       rm -rf node_modules/electron && pnpm install"
fi

# better-sqlite3 compiled binding for the host Node ABI. Electron uses
# its own ABI (145 vs Node 137 today), so this file is the Node-side
# binding used by tests and standalone server runs; scripts/ensure-native-runtime.mjs
# handles Electron-side swapping at boot.
if [ -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
    echo "✓ better-sqlite3 native binding compiled"
else
    echo "✗ better-sqlite3 native binding missing."
    echo "  Auto-repair:   pnpm --filter @puntovivo/server run native:rebuild:node"
fi

echo ""
echo "======================================"
echo "  Checking Servers"
echo "======================================"
echo ""

# Check backend server
echo "Checking backend server (port 8090)..."
if curl -s http://localhost:8090/api/health > /dev/null 2>&1; then
    echo "✓ Backend server is running at http://localhost:8090"
else
    echo "✗ Backend server is NOT running"
    echo "  Start it with: pnpm run dev:server"
fi

# Check frontend server
echo "Checking frontend server (port 3000)..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ Frontend server is running at http://localhost:3000"
else
    echo "✗ Frontend server is NOT running"
    echo "  Start it with: pnpm run dev:web"
fi

echo ""
echo "======================================"
echo "  Quick Start Commands"
echo "======================================"
echo ""
echo "Desktop App (Electron):"
echo "  pnpm run dev:desktop"
echo ""
echo "Web App (Browser):"
echo "  pnpm run dev:web-stack"
echo ""
echo "Default Login:"
echo "  Email: admin@localhost"
echo "  Password: (generated on first run, check server console output)"
echo ""
echo "======================================"
