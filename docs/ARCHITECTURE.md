# Open Yojob Architecture Guide

> For new collaborators: this document provides a comprehensive overview of the Open Yojob project architecture.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Directory Structure](#directory-structure)
4. [Component Deep Dive](#component-deep-dive)
5. [Data Flow](#data-flow)
6. [How to Run](#how-to-run)
7. [How to Debug](#how-to-debug)
8. [Considerations](#considerations)
9. [Limitations](#limitations)

---

## System Overview

Open Yojob is a **Point of Sale (POS) desktop application** built with an offline-first architecture. It combines:

- **Electron Forge** for cross-platform desktop delivery
- **React 19 + TypeScript** for the user interface
- **Fastify** (embedded in-process) as the backend API server
- **Drizzle ORM + SQLite** for type-safe database access
- **Server-Sent Events (SSE)** for real-time updates
- **tRPC** (partially integrated) for end-to-end type-safe API calls

### Key Design Principles

```
+-------------------------------------------------------------------+
|                      DESIGN PRINCIPLES                             |
+-------------------------------------------------------------------+
|  - Offline-First    : Works without internet                       |
|  - Multi-Tenant     : Complete data isolation per business         |
|  - Embedded Backend : Fastify runs in-process (no separate binary) |
|  - Cross-Platform   : Windows, macOS, Linux                        |
|  - Auto-Updates     : Seamless updates via GitHub Releases         |
|  - Type-Safe        : Drizzle ORM + TypeScript end-to-end          |
+-------------------------------------------------------------------+
```

**Important:** The Fastify server runs **in-process** inside the Electron main process. It is NOT a spawned child process. `apps/desktop/src/main/` imports `@open-yojob/server` directly.

---

## Architecture Diagram

```
+------------------------------------------------------------------------+
|                       OPEN YOJOB DESKTOP APP                            |
|                        (Electron Forge)                                 |
+------------------------------------------------------------------------+
|                                                                         |
|  +-------------------------------------------------------------------+ |
|  |                     RENDERER PROCESS (Chromium)                     | |
|  |                                                                    | |
|  |  +-----------+  +------------+  +----------------------------+    | |
|  |  |  Pages /  |  | Components |  |   State Management         |    | |
|  |  |  Routes   |  | (Reusable) |  |   (Zustand + TanStack Q)   |    | |
|  |  +-----------+  +------------+  +----------------------------+    | |
|  |                                                                    | |
|  |  +--------------------------------------------------------------+ | |
|  |  |                  Services Layer                               | | |
|  |  |  - API Client (fetch-based REST + SSE)                       | | |
|  |  |  - Real-time Service (Server-Sent Events)                    | | |
|  |  |  - Sync Service (conflict resolution)                        | | |
|  |  +--------------------------------------------------------------+ | |
|  +-------------------------------------------------------------------+ |
|                                  |                                      |
|                         IPC Bridge (Context Isolation)                   |
|                                  |                                      |
|  +-------------------------------------------------------------------+ |
|  |                     PRELOAD SCRIPT                                  | |
|  |  Exposes safe APIs: electronAPI.getVersion(), getServerUrl()       | |
|  +-------------------------------------------------------------------+ |
|                                  |                                      |
|  +-------------------------------------------------------------------+ |
|  |                      MAIN PROCESS (Node.js)                        | |
|  |                                                                    | |
|  |  +-------------+  +-------------+  +---------------------------+  | |
|  |  | Window      |  | Auto        |  | Fastify Server            |  | |
|  |  | Management  |  | Updater     |  | (In-Process)              |  | |
|  |  +-------------+  +-------------+  +---------------------------+  | |
|  |                                            |                       | |
|  |  +-------------------------------------------+                    | |
|  |  | @open-yojob/server Package                 |                    | |
|  |  | - Drizzle ORM + SQLite                     |                    | |
|  |  | - Auth Routes (JWT + argon2)               |                    | |
|  |  | - Collections CRUD (tenant-isolated)       |                    | |
|  |  | - Sync Queue                               |                    | |
|  |  | - SSE Real-time                            |                    | |
|  |  | - Rate Limiting (@fastify/rate-limit)       |                    | |
|  |  +--------------------------------------------+                    | |
|  +-------------------------------------------------------------------+ |
|                                                                         |
+-------------------------------------------------------------------------+

                         API: http://127.0.0.1:8090

  +---------------------------------------------------------------------+
  |                        API ENDPOINTS                                 |
  +---------------------------------------------------------------------+
  |  /api/auth/*          : Authentication (login, logout, refresh)      |
  |  /api/collections/*   : CRUD operations with tenant isolation        |
  |  /api/sync/*          : Local sync queue                             |
  |  /api/realtime/*      : Server-Sent Events subscriptions             |
  |  /api/trpc/*          : tRPC endpoints (partial)                     |
  |  /health              : Health check                                 |
  +---------------------------------------------------------------------+
```

---

## Directory Structure

```
open_yojob/
|
+-- apps/
|   +-- desktop/                     # Electron Forge app
|   |   +-- forge.config.ts          # Electron Forge configuration
|   |   +-- package.json             # Desktop app dependencies
|   |   +-- vite.main.config.ts      # Vite config for main process
|   |   +-- vite.preload.config.ts   # Vite config for preload
|   |   +-- vite.renderer.config.ts  # Vite config for renderer
|   |   +-- src/
|   |       +-- main/                # Main process
|   |       |   +-- index.ts         # Entry point + embedded server start
|   |       |   +-- auto-updater.ts  # GitHub releases auto-update
|   |       +-- preload/             # Preload (IPC bridge)
|   |       |   +-- index.ts         # Context bridge APIs
|   |       |   +-- index.d.ts       # TypeScript declarations
|   |       +-- renderer/            # Renderer (React)
|   |           +-- App.tsx
|   |           +-- index.tsx
|   |           +-- index.css
|   |
|   +-- web/                         # Standalone web app
|       +-- vite.config.ts           # Vite + Tailwind v4 plugin
|       +-- src/
|           +-- index.css            # Tailwind v4 @theme configuration
|           +-- lib/utils.ts         # cn() helper (clsx + tailwind-merge)
|           +-- components/
|           |   +-- ui/              # CVA-based primitives
|           |   +-- form-controls/   # Complex form components
|           |   +-- layout/          # Layout components
|           |   +-- tables/          # DataTable, exports (CSV, PDF)
|           +-- features/
|           |   +-- auth/            # Authentication
|           |   +-- customers/       # Customer management
|           |   +-- dashboard/       # Dashboard views
|           |   +-- inventory/       # Inventory tracking
|           |   +-- products/        # Product catalog
|           |   +-- sales/           # Sales & transactions
|           |   +-- tenant/          # Multi-tenant management
|           +-- hooks/               # Custom React hooks
|           +-- services/api/        # API client (shared with desktop)
|           +-- types/               # TypeScript type definitions
|
+-- packages/
|   +-- server/                      # @open-yojob/server package
|       +-- package.json
|       +-- drizzle.config.ts        # Drizzle ORM configuration
|       +-- src/
|           +-- index.ts             # Server factory (createServer)
|           +-- standalone.ts        # Standalone entry point
|           +-- db/
|           |   +-- schema.ts        # Drizzle schema definitions
|           |   +-- index.ts         # Database initialization
|           |   +-- seed.ts          # Default data seeding
|           +-- routes/
|           |   +-- auth.ts          # Authentication (JWT + argon2)
|           |   +-- collections.ts   # Generic CRUD with tenant isolation
|           |   +-- sync.ts          # Sync queue management
|           +-- realtime/
|           |   +-- sse.ts           # Server-Sent Events
|           +-- trpc/                # tRPC layer (partial)
|               +-- router.ts
|               +-- context.ts
|
+-- scripts/
|   +-- migration/                   # Legacy data migration tools (.NET WinForms -> Node)
|
+-- .github/
|   +-- workflows/
|   |   +-- ci.yml                   # CI pipeline (test, lint, build)
|   |   +-- release.yml              # Release pipeline (tag-triggered)
|   |   +-- build.yml                # Build pipeline
|   +-- dependabot.yml               # Automated dependency updates
|   +-- ISSUE_TEMPLATE/
|       +-- security.md              # Security vulnerability template
|
+-- docs/                            # Documentation
    +-- ARCHITECTURE.md              # This file
    +-- COMPONENTS.md                # UI component catalog
    +-- DEBUGGING.md                 # Debugging guide (VSCode, DevTools)
    +-- ENVIRONMENT_CONFIGURATION.md # Environment variables
    +-- LOGIN_GUIDE.md               # Authentication guide
    +-- SECURITY.md                  # Security analysis and fixes
    +-- STYLING.md                   # Tailwind v4 + CVA styling guide
    +-- TROUBLESHOOTING.md           # Common issues and solutions
    +-- TRPC_ARCHITECTURE.md         # tRPC analysis and architecture
    +-- TRPC_IMPLEMENTATION_PLAN.md  # tRPC migration plan
    +-- TRPC_TESTING_GUIDE.md        # tRPC testing patterns
    +-- MIGRATION_PLAN.md            # Full migration plan (.NET WinForms yojob -> open_yojob)
```

---

## Component Deep Dive

### Main Process (`apps/desktop/src/main/`)

| File              | Responsibility                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| `index.ts`        | App lifecycle, window creation, IPC handlers, starts embedded Fastify server |
| `auto-updater.ts` | Check for updates from GitHub Releases, download & install                   |

### Preload Script (`apps/desktop/src/preload/`)

The preload script acts as a **secure bridge** between the renderer and main processes:

```typescript
// Exposed APIs (via contextBridge)
window.electronAPI = {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
};
```

### Backend Server (`packages/server/src/`)

| File/Directory          | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `index.ts`              | Server factory, JWT setup, rate limiting     |
| `standalone.ts`         | Entry point for standalone server mode       |
| `db/schema.ts`          | Drizzle ORM schema definitions               |
| `db/seed.ts`            | Default data seeding (secure random admin)   |
| `routes/auth.ts`        | JWT login/logout/refresh, password policy    |
| `routes/collections.ts` | Generic CRUD with mandatory tenant isolation |
| `routes/sync.ts`        | Sync queue management                        |
| `realtime/sse.ts`       | Server-Sent Events for live updates          |

### Renderer/UI (`apps/web/src/`)

The UI is organized by **feature modules**:

| Feature      | Purpose                                  |
| ------------ | ---------------------------------------- |
| `auth/`      | Login, logout, session management        |
| `tenant/`    | Tenant selection, multi-business support |
| `products/`  | Product catalog CRUD                     |
| `customers/` | Customer management                      |
| `sales/`     | POS transactions, receipts               |
| `inventory/` | Stock tracking, movements                |
| `dashboard/` | Analytics, reports                       |

### Styling Architecture

The project uses **Tailwind CSS v4** with the native Vite plugin and **CVA (class-variance-authority)** for component variants. See [docs/STYLING.md](./STYLING.md) for detailed guidelines.

Key files:

- `index.css`: Theme configuration via `@theme` block
- `lib/utils.ts`: `cn()` utility combining `clsx` + `tailwind-merge`
- `components/ui/*.tsx`: CVA-based primitive components

---

## Data Flow

### Typical Create Operation

```
1. User fills form in React UI
         |
         v
2. Form submission triggers mutation (TanStack Query)
         |
         v
3. Service layer calls Fastify API
         |
         +--- POST /api/collections/{name}/records
         |         |
         |         v
         |    Fastify validates request
         |    Drizzle ORM inserts into SQLite
         |    Returns created record with ID
         |
         +--- Offline: Save to local SQLite + add to sync queue
                       |
                       v
                  When online: Sync service processes queue
```

### Authentication Flow

```
1. User enters credentials
         |
         v
2. POST /api/auth/login
         |
         v
3. Fastify validates credentials (argon2 hash comparison)
         |
         +--- Success: Returns JWT token + user record
         |              |
         |              v
         |         Store token in Zustand state
         |         Set Authorization header for future requests
         |
         +--- Failure: 401 error (rate limited: 5 attempts / 15 min)
```

---

## How to Run

### Prerequisites

```bash
node --version   # >= 22.0.0 (enforced by root package.json)
npm --version    # >= 10.0.0
```

### Development Mode

```bash
# 1. Clone and install
git clone https://github.com/johnny4young/open_yojob.git
cd open_yojob
npm install

# 2. Rebuild native modules for Electron
npx electron-rebuild -m apps/desktop

# 3. Start the full desktop app
npm run dev

# Or start individual pieces:
npm run dev:web     # Web only on port 3000
npm run dev:server  # Backend only on port 8090
```

### Running Tests

```bash
npm run test --workspace=@open-yojob/web     # React + Vitest (watch mode)
npm run test --workspace=@open-yojob/server  # Server + Vitest
```

### Building for Production

```bash
npm run build    # Build web + create desktop packages
```

---

## How to Debug

See [docs/DEBUGGING.md](./DEBUGGING.md) for the complete debugging guide with VSCode configurations.

### Quick Reference

| Issue                | Debug Approach                                           |
| -------------------- | -------------------------------------------------------- |
| Server won't start   | Check main process logs, verify port 8090 is free        |
| IPC not working      | Check preload script, verify contextIsolation settings   |
| Data not showing     | Check TanStack Query devtools, verify cache invalidation |
| Auth issues          | Check JWT token in Zustand state, verify tenant context  |
| Native module errors | Run `npx electron-rebuild -m apps/desktop`               |

---

## Considerations

### Security

| Aspect            | Implementation                                        |
| ----------------- | ----------------------------------------------------- |
| Context Isolation | Enabled - renderer cannot access Node.js directly     |
| Node Integration  | Disabled in renderer                                  |
| Sandbox           | Disabled (needed for better-sqlite3 native module)    |
| CORS              | Configured for localhost only                         |
| Auth Tokens       | Stored in memory (Zustand), not localStorage          |
| Rate Limiting     | 5 login attempts per 15 minutes                       |
| Password Policy   | 12+ characters with complexity requirements           |
| Tenant Isolation  | Mandatory tenantId check on all collection operations |

See [docs/SECURITY.md](./SECURITY.md) for the full security analysis and fix history.

### Performance

| Area            | Strategy                                   |
| --------------- | ------------------------------------------ |
| Table Rendering | TanStack Virtual for large datasets        |
| API Caching     | TanStack Query with stale-while-revalidate |
| Bundle Size     | Vite tree-shaking, code splitting          |
| Startup Time    | Lazy load non-critical features            |

---

## Limitations

### Current Limitations

| Limitation                 | Reason / Workaround                                 |
| -------------------------- | --------------------------------------------------- |
| Windows only auto-updates  | Squirrel.Windows; macOS needs notarization setup    |
| No real-time collaboration | SSE available but not fully utilized                |
| Single-machine only        | Designed as desktop app, not networked              |
| English-only UI            | i18n framework not yet integrated                   |
| No barcode scanner support | Planned for future release                          |
| Limited report exports     | CSV, Excel, PDF available; no custom report builder |

### Technical Debt

- [ ] Complete tRPC migration (only health.check endpoint exists)
- [ ] Add comprehensive unit tests for main process
- [ ] Implement E2E tests with Playwright
- [ ] Add error boundary and crash reporting
- [ ] Implement session invalidation on password change
- [ ] Enable Electron sandbox mode

### Platform-Specific Notes

| Platform | Notes                                           |
| -------- | ----------------------------------------------- |
| Windows  | Requires code signing for auto-updates          |
| macOS    | Requires notarization for Gatekeeper approval   |
| Linux    | Tested on Ubuntu/Debian; other distros may vary |

---

## Quick Reference

### Key URLs (Development)

| Service        | URL                          |
| -------------- | ---------------------------- |
| Electron App   | Launches as desktop window   |
| Web Dev Server | http://localhost:3000        |
| Fastify API    | http://127.0.0.1:8090/api/   |
| Health Check   | http://127.0.0.1:8090/health |

### Key Commands

```bash
npm run dev              # Full desktop app
npm run dev:web          # Web only (port 3000)
npm run dev:server       # Backend only (port 8090)
npm run build            # Build web + desktop packages
npm run test --workspace=@open-yojob/web     # Web tests
npm run test --workspace=@open-yojob/server  # Server tests
```

### Environment Variables

See [docs/ENVIRONMENT_CONFIGURATION.md](./ENVIRONMENT_CONFIGURATION.md) for the full list.

| Variable              | Purpose                     | Default        |
| --------------------- | --------------------------- | -------------- |
| `DISABLE_AUTO_UPDATE` | Skip auto-update checks     | `false`        |
| `SERVER_PORT`         | Fastify server port         | `8090`         |
| `NODE_ENV`            | Development/production mode | `development`  |
| `JWT_SECRET`          | JWT signing key             | Auto-generated |
