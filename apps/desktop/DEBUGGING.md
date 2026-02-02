# Desktop App Debugging Guide

This guide explains how to debug the Electron desktop application with TypeScript source maps.

## Prerequisites

- VSCode installed
- Desktop app dependencies installed (`npm install`)

## Quick Start

### Option 1: VSCode Debug Menu (Recommended)

1. Open VSCode in the `apps/desktop` directory
2. Press `F5` or click "Run > Start Debugging"
3. Choose **"Electron: Main + Renderer"** from the debug configurations
4. Set breakpoints in your TypeScript files (`*.ts`, `*.tsx`)
5. The app will launch with debugger attached

### Option 2: Command Line + VSCode Attach

```bash
# Terminal 1: Start desktop app with debugging enabled
npm run dev:debug

# Terminal 2: Start web dev server (for renderer)
cd ../web && npm run dev

# In VSCode: Press F5 and select "Electron Main Process" or "Electron Renderer Process"
```

## Available Debug Scripts

| Script                  | Description                      | When to Use                           |
| ----------------------- | -------------------------------- | ------------------------------------- |
| `npm run dev`           | Normal development mode          | Regular development without debugging |
| `npm run dev:debug`     | Main process debugging           | Debug Electron main process (backend) |
| `npm run dev:debug-brk` | Main process with pause on start | Debug app initialization              |
| `npm run dev:server`    | Enhanced server logging          | Debug embedded Fastify server         |
| `npm run clean:cache`   | Clear Vite cache and restart     | Fix weird build issues                |

## VSCode Debug Configurations

### 1. **Electron Main Process**

- **Use**: Debug main process (Electron backend)
- **Port**: 5858
- **How**: Run `npm run dev:debug`, then press F5 and select this config

### 2. **Electron Renderer Process**

- **Use**: Debug renderer (React UI)
- **Port**: 9222
- **How**: Start app normally, then press F5 and select this config

### 3. **Electron: Main + Renderer**

- **Use**: Debug both processes simultaneously (best for full-stack debugging)
- **How**: Just press F5 (default configuration)

### 4. **Electron: Debug from Start**

- **Use**: Pause on first line of main process
- **How**: Press F5 and select this config

### 5. **Server Tests**

- **Use**: Debug vitest tests in `packages/server`
- **How**: Press F5 and select this config

## Setting Breakpoints

### TypeScript Files

1. Open any `.ts` or `.tsx` file in `apps/desktop/src/`
2. Click in the gutter (left of line numbers) to set a red dot
3. Start debugging with F5
4. Code will pause when breakpoint is hit

### Example Breakpoint Locations

- **Main Process**: `apps/desktop/src/main/index.ts`
- **Renderer**: `apps/desktop/src/renderer/App.tsx`
- **Preload**: `apps/desktop/src/preload/index.ts`

## Debugging Workflow

### Debug Main Process Issue

```bash
# 1. Start with debugging enabled
npm run dev:debug

# 2. In VSCode: F5 → "Electron Main Process"
# 3. Set breakpoints in src/main/index.ts
# 4. Trigger the issue
# 5. Inspect variables in VSCode Debug panel
```

### Debug Renderer (UI) Issue

```bash
# 1. Start app normally
npm run dev

# 2. In VSCode: F5 → "Electron Renderer Process"
# 3. Set breakpoints in src/renderer/*.tsx
# 4. Interact with UI to trigger breakpoints
```

### Debug Server Startup

```bash
# 1. Run with pause on start
npm run dev:debug-brk

# 2. In VSCode: F5 → "Electron Main Process"
# 3. Debugger pauses on first line
# 4. Step through initialization (F10 = step over, F11 = step into)
```

## Troubleshooting

### Breakpoints Not Hitting

- **Check**: Source maps enabled (✓ already configured)
- **Fix**: Run `npm run clean:cache` to clear Vite cache
- **Verify**: Look for `.map` files in `.vite/build/` directory

### "Cannot connect to runtime process"

- **Fix**: Ensure app is running with `npm run dev:debug`
- **Check**: Port 5858 is not blocked by firewall
- **Try**: Restart both app and VSCode

### Source Maps Not Loading

```bash
# Rebuild with clean cache
npm run clean:cache

# Verify source maps exist
ls -la .vite/build/*.map
ls -la .vite/preload/*.map
```

### Slow Debugging

- **Cause**: Source maps add overhead
- **Fix**: Use `npm run dev` for normal development
- **Tip**: Only use debug mode when actively debugging

## Advanced: Chrome DevTools

The Electron app also supports Chrome DevTools:

1. Start app: `npm run dev`
2. Open Chrome DevTools from app menu (if available)
3. Or attach external Chrome DevTools to port 9222

## Tips

- **Use `npm run dev` normally** - only enable debugging when needed
- **Set conditional breakpoints** - Right-click breakpoint → Edit Breakpoint
- **Use logpoints** - Right-click in gutter → Add Logpoint (no code changes!)
- **Watch expressions** - Add variables to Watch panel in VSCode
- **Call stack inspection** - See full execution path in Debug panel

## Source Map Configuration

Source maps are already configured in:

- `vite.main.config.ts` - Main process source maps
- `vite.preload.config.ts` - Preload script source maps
- `tsconfig.json` - TypeScript source map generation

**No additional setup required!** Just press F5 to start debugging.

## Common Debug Scenarios

### Scenario 1: "App crashes on startup"

```bash
npm run dev:debug-brk  # Pauses before any code runs
# F5 → "Electron Main Process"
# Step through initialization with F10
```

### Scenario 2: "Button click not working"

```bash
npm run dev  # Start app
# F5 → "Electron Renderer Process"
# Set breakpoint in button click handler
# Click button in app
```

### Scenario 3: "Database query failing"

```bash
npm run dev:server  # Enhanced logging
# Check terminal for Fastify logs
# Set breakpoints in server routes (packages/server/src/routes/)
```

## Additional Resources

- [VSCode Debugging Guide](https://code.visualstudio.com/docs/editor/debugging)
- [Electron Debugging Docs](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
- [Chrome DevTools Reference](https://developer.chrome.com/docs/devtools/)
