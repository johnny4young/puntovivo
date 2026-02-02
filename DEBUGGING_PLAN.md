# Desktop App Development & Debugging Plan

## Current State Analysis

### ✅ What's Working

1. **Two Run Modes Exist:**
   - `npm run dev` - Development mode with hot reload
   - `npm run make` - Build production distributables

2. **Development Setup:**
   - Electron Forge with Vite plugin
   - TypeScript compilation via Vite (not tsc)
   - Main process: `src/main/index.ts` → `.vite/build/index.cjs`
   - Preload: `src/preload/index.ts` → `.vite/preload/index.cjs`
   - Renderer: Uses web app dev server at `localhost:3000` in dev mode
   - DevTools opens automatically in development
   - Console logs forwarded from renderer to terminal

3. **Production Setup:**
   - Builds with `electron-forge make`
   - Uses packaged web app from `apps/web/dist`
   - Native modules (better-sqlite3, argon2) rebuilt for Electron

### ❌ What's Missing

1. **No Source Maps:**
   - `vite.main.config.ts` doesn't enable source maps
   - `vite.preload.config.ts` doesn't enable source maps
   - TypeScript `tsconfig.json` has `noEmit: true` (no .map files)
   - **Can't set breakpoints in TypeScript source files**

2. **No VSCode Debug Configuration:**
   - No `.vscode/launch.json`
   - No way to attach VSCode debugger to main/preload process
   - Can only use `console.log` debugging

3. **Vite Build Options Not Optimized for Debugging:**
   - No `sourcemap: true` in build config
   - No `minify: false` for easier debugging

4. **No Separate Debug Script:**
   - Only one dev script
   - No `dev:debug` with inspector enabled
   - No way to pause on startup for early debugging

## Refactoring Plan

### Phase 1: Enable Source Maps (Critical for Debugging)

**Files to modify:**

1. `apps/desktop/vite.main.config.ts`
2. `apps/desktop/vite.preload.config.ts`
3. `apps/desktop/tsconfig.json`

**Changes:**

```typescript
// vite.main.config.ts
export default defineConfig({
  build: {
    sourcemap: true, // Enable source maps
    minify: false, // Don't minify in dev builds
    rollupOptions: {
      /* ... */
    },
  },
});
```

### Phase 2: Add VSCode Debug Configuration

**Files to create:**

1. `.vscode/launch.json` - Debug configurations
2. `.vscode/tasks.json` - Build tasks for debugging

**Debug configurations to add:**

- **Electron Main Process** - Debug main process TypeScript
- **Electron Renderer Process** - Debug web app in Chrome DevTools
- **Electron All** - Debug both main + renderer simultaneously
- **Server (Embedded)** - Debug embedded Fastify server

### Phase 3: Enhanced Dev Scripts

**Add to `apps/desktop/package.json`:**

```json
{
  "scripts": {
    "dev": "npm run rebuild && electron-forge start",
    "dev:debug": "npm run rebuild && ELECTRON_ENABLE_LOGGING=1 electron-forge start -- --inspect=5858",
    "dev:debug-brk": "npm run rebuild && electron-forge start -- --inspect-brk=5858",
    "dev:server": "DEBUG=fastify:* npm run dev",
    "clean:cache": "rm -rf .vite && npm run dev"
  }
}
```

**Script purposes:**

- `dev` - Normal development with hot reload + DevTools
- `dev:debug` - Enable Node.js inspector on port 5858 (attach debugger anytime)
- `dev:debug-brk` - Pause on startup, wait for debugger to attach
- `dev:server` - Extra logging for embedded server debugging
- `clean:cache` - Fix stale Vite cache issues

### Phase 4: Environment-Specific Builds

**Add to `apps/desktop/forge.config.ts`:**

```typescript
plugins: [
  new VitePlugin({
    build: [
      {
        entry: 'src/main/index.ts',
        config: 'vite.main.config.ts',
        target: 'main',
      },
    ],
  }),
],
```

**Create:** `apps/desktop/vite.main.config.dev.ts` (dev-specific config)

### Phase 5: Debugging Tools Integration

**Add to dependencies:**

```json
{
  "devDependencies": {
    "electron-devtools-installer": "^3.2.0"
  }
}
```

**Install React DevTools in development:**

```typescript
// src/main/index.ts
if (isDev) {
  const { default: installExtension, REACT_DEVELOPER_TOOLS } =
    await import('electron-devtools-installer');
  await installExtension(REACT_DEVELOPER_TOOLS);
}
```

## Implementation Priority

### 🔴 High Priority (Do First)

1. ✅ Enable source maps in Vite configs
2. ✅ Create VSCode launch.json with Electron debugging
3. ✅ Add `dev:debug` and `dev:debug-brk` scripts

### 🟡 Medium Priority (Do Next)

4. ✅ Add TypeScript source map support in tsconfig
5. ✅ Install and configure React DevTools
6. ✅ Add server debug logging script

### 🟢 Low Priority (Nice to Have)

7. Add Electron DevTools extensions
8. Create debugging documentation
9. Add pre-commit hooks to validate source maps

## Expected Workflow After Refactoring

### Normal Development:

```bash
# Terminal 1: Start web app dev server
cd apps/web && npm run dev

# Terminal 2: Start Electron with hot reload
cd apps/desktop && npm run dev
```

### Debug with Breakpoints (VSCode):

```bash
# Option 1: Start from VSCode
# Press F5 → Select "Electron Main + Renderer"

# Option 2: Attach to running process
cd apps/desktop && npm run dev:debug
# Then in VSCode: F5 → "Attach to Electron Main"
```

### Debug on Startup:

```bash
cd apps/desktop && npm run dev:debug-brk
# App pauses on first line
# Open VSCode → F5 → "Attach to Electron Main"
# Set breakpoints, then continue
```

### Debug Server Issues:

```bash
cd apps/desktop && npm run dev:server
# Extra Fastify logs in terminal
```

## Benefits After Implementation

✅ **Set breakpoints in TypeScript files** (main, preload, renderer)
✅ **Step through code** with full variable inspection
✅ **Pause on exceptions** to see exact failure point
✅ **Hot reload** works with debugging active
✅ **Multiple debug targets** (main, renderer, server) simultaneously
✅ **Console logs** still work as backup
✅ **No performance impact** on production builds (source maps only in dev)

## Files to Create/Modify

### To Create:

- [ ] `.vscode/launch.json`
- [ ] `.vscode/tasks.json` (optional, for pre-launch tasks)

### To Modify:

- [ ] `apps/desktop/package.json` (add debug scripts)
- [ ] `apps/desktop/vite.main.config.ts` (enable sourcemap)
- [ ] `apps/desktop/vite.preload.config.ts` (enable sourcemap)
- [ ] `apps/desktop/tsconfig.json` (enable sourceMap option)
- [ ] `apps/desktop/src/main/index.ts` (add React DevTools in dev)

## Testing Checklist

After implementation, verify:

- [ ] `npm run dev` works as before
- [ ] `npm run dev:debug` starts with inspector active
- [ ] VSCode can attach debugger to main process
- [ ] Breakpoints in `.ts` files work
- [ ] Hot reload still works with debugger attached
- [ ] DevTools opens in renderer
- [ ] Console logs still appear in terminal
- [ ] Production build (`npm run make`) still works
- [ ] Production build has NO source maps (security)

---

**Status:** 📋 Plan created, ready for implementation
**Estimated Time:** 2-3 hours for full implementation + testing
**Risk:** Low (changes are additive, existing workflow not affected)
