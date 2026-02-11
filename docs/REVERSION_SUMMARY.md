# Reversion to Simplified npm Scripts - Summary

**Date**: 2026-02-10  
**Status**: ✅ Complete

## Overview

Reverted the repository to use the original simplified npm scripts and removed all custom features that were added in previous commits. This simplification reduces complexity and makes the codebase easier to maintain.

## What Was Removed

### 1. Custom npm Scripts
- ❌ `dev:desktop-wait` - Cross-platform wait script
- ❌ `dev:desktop-standalone` - Standalone desktop mode
- ❌ `build:server` - Explicit server build command

### 2. Custom Features
- ❌ STANDALONE_MODE environment variable logic
- ❌ Conditional postinstall script
- ❌ cross-env dependency

### 3. Documentation
- ❌ `docs/STANDALONE_DESKTOP_GUIDE.md`
- ❌ `docs/QUESTION_ANSWERED.md`
- ❌ `docs/NPM_RUN_DEV_GUIDE.md`
- ❌ `docs/DESKTOP_APP_SETUP.md`
- ❌ `docs/CI_PIPELINE_FIXES.md`

## What Was Kept

### Important Fixes
- ✅ `lucide-react@0.469.0` - Fixes React 19 peer dependency
- ✅ `.npmrc` - Consistent npm behavior
- ✅ `docs/ENVIRONMENT_CONFIGURATION.md` - Still useful

### Core Features
- ✅ tRPC Phase 1 integration
- ✅ All tRPC documentation
- ✅ Multi-tenant architecture
- ✅ Authentication and security features

## Current npm Scripts

```json
{
  "dev": "npm run start --workspace=@open-yojob/desktop",
  "dev:web": "npm run dev --workspace=@open-yojob/web",
  "dev:server": "npm run dev --workspace=@open-yojob/server",
  "dev:fullstack": "concurrently -n \"SERVER,WEB\" -c \"blue,green\" \"npm run dev:server\" \"npm run dev:web\"",
  "dev:all": "concurrently \"npm run dev:web\" \"sleep 3 && npm run dev:desktop-only\"",
  "dev:desktop-only": "npm run start --workspace=@open-yojob/desktop",
  "build": "npm run build --workspace=@open-yojob/web && npm run make --workspace=@open-yojob/desktop",
  "build:web": "npm run build --workspace=@open-yojob/web",
  "start": "npm run start --workspace=@open-yojob/desktop",
  "make": "npm run make --workspace=@open-yojob/desktop",
  "publish": "npm run publish --workspace=@open-yojob/desktop",
  "clean": "rm -rf node_modules apps/*/node_modules",
  "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\""
}
```

## Development Workflow

### For Desktop Development
```bash
# Desktop app (expects web dev server on port 3000)
npm run dev

# Or start web + desktop together
npm run dev:all
```

### For Web Development
```bash
# Full stack (server + web)
npm run dev:fullstack

# Or separately
npm run dev:web      # Frontend only
npm run dev:server   # Backend only
```

### Building
```bash
npm run build:web    # Build web only
npm run build        # Build and package desktop
npm run make         # Package desktop
```

## Desktop App Modes

The desktop app now has just two modes:

1. **Development Mode** (`isDev = true`)
   - Loads from web dev server at `http://localhost:3000`
   - Embedded Fastify server on port 8090
   - DevTools open automatically

2. **Production Mode** (`isDev = false`)
   - Loads from packaged web app
   - Embedded Fastify server on port 8090
   - No DevTools

## Benefits of Simplification

✅ **Fewer scripts** → Easier to understand  
✅ **Less complexity** → Easier to maintain  
✅ **Standard workflow** → Familiar to developers  
✅ **Cleaner docs** → Less to read and learn  
✅ **Easier onboarding** → Simpler for new contributors

## Breaking Changes

None. The reversion only removes recently added custom features. Original functionality is preserved.

## Migration Guide

If you were using removed features:

### `npm run dev:desktop-standalone` → Use `npm run dev:all`
The standalone mode is removed. Use `dev:all` to run web + desktop together.

### `npm run build:server` → Use workspace command
```bash
# Instead of: npm run build:server
npm run build --workspace=@open-yojob/server
```

## Questions?

See:
- [Quick Start Guide](./TRPC_QUICK_START.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [Environment Configuration](./ENVIRONMENT_CONFIGURATION.md)
