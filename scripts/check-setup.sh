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

FAILED=0

echo ""
echo "Checking if dependencies are installed..."
if [ -d "node_modules" ]; then
    echo "✓ Dependencies installed"
else
    echo "✗ Dependencies not installed. Run: pnpm install --frozen-lockfile"
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
# `require('electron')` or while loading a native addon.

GLOBAL_IGNORE=$(pnpm config get ignore-scripts --global 2>/dev/null || echo "")
PROJECT_IGNORE=$(pnpm config get ignore-scripts 2>/dev/null || echo "")
if [ "$GLOBAL_IGNORE" = "true" ] && [ "$PROJECT_IGNORE" != "false" ]; then
    echo "⚠ Your global ~/.npmrc has ignore-scripts=true and this repo's"
    echo "   .npmrc override is not being picked up."
    echo "   Re-run: pnpm install --frozen-lockfile (and check pnpm-workspace.yaml allowBuilds)"
fi

# Electron's runtime is installed lazily by the desktop preflight, not by an
# npm postinstall hook. Missing is normal immediately after dependency install.
ELECTRON_DIR="node_modules/electron"
[ -f "$ELECTRON_DIR/path.txt" ] || ELECTRON_DIR="apps/desktop/node_modules/electron"
if [ ! -f "$ELECTRON_DIR/path.txt" ]; then
    echo "ℹ Electron runtime not prepared yet (pnpm run dev:desktop installs it)"
    echo "  Prepare now:   node scripts/ensure-electron-binary.mjs"
elif [ -e "$ELECTRON_DIR/dist/$(tr -d '[:space:]' < "$ELECTRON_DIR/path.txt")" ]; then
    echo "✓ Electron runtime installed ($ELECTRON_DIR)"
else
    echo "✗ Electron runtime incomplete: path.txt points to a missing executable."
    echo "  Auto-repair:   node scripts/ensure-electron-binary.mjs"
    echo "  Nuclear:       rm -rf node_modules/electron && pnpm install --frozen-lockfile"
    FAILED=1
fi

# better-sqlite3-multiple-ciphers v13 bundles one Node-API binary per target.
# Execute the real Node verifier instead of checking a stale build path.
if node scripts/ensure-native-runtime.mjs node > /dev/null 2>&1; then
    echo "✓ better-sqlite3 Node-API binding and SQLCipher contract verified"
else
    echo "✗ better-sqlite3 Node-API binding missing or unusable."
    echo "  Diagnose:      pnpm --filter @puntovivo/server run native:ensure:node"
    echo "  Recovery:      pnpm install --frozen-lockfile"
    FAILED=1
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
    echo "ℹ Backend server not running. Start it with: pnpm run dev:server"
fi

# Check frontend server
echo "Checking frontend server (port 3000)..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✓ Frontend server is running at http://localhost:3000"
else
    echo "ℹ Frontend server not running. Start it with: pnpm run dev:web"
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
echo "First-use ownership:"
echo "  A new installation has no default administrator or password."
echo "  Open the login screen and create the business and its owner."
echo "  Standalone web: use the private installation code from the local server startup output."
echo "  Electron: complete setup in the main application window."
echo "  Existing installations: sign in with an account already created for that business."
echo "  Explicit demo/test seeds are separate; see docs/DEV-SEED.md."
echo ""
echo "======================================"

exit $FAILED
