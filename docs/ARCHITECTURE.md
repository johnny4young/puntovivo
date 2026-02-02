# Open Yojob Architecture Guide

> **⚠️ DOCUMENTATION UPDATE IN PROGRESS**: This document contains outdated references to PocketBase (Go backend). The backend was migrated to **Node.js/Fastify + Drizzle ORM** in 2025. Sections marked with "🔧 CUSTOM POCKETBASE" or mentioning Go are outdated. See [README.md](../README.md) for current architecture.

> **For New Collaborators**: This document provides a comprehensive overview of the Open Yojob project architecture, designed to help you understand and contribute to the codebase effectively.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Diagrams](#architecture-diagrams)
3. [Component Deep Dive](#component-deep-dive)
4. [Data Flow](#data-flow)
5. [How to Run](#how-to-run)
6. [How to Debug](#how-to-debug)
7. [Development Workflow](#development-workflow)
8. [Considerations](#considerations)
9. [Limitations](#limitations)

---

## System Overview

Open Yojob is a **modern Point of Sale (POS) desktop application** built with an offline-first architecture. It combines:

- **Electron Forge** for cross-platform desktop delivery
- **React + TypeScript** for the user interface
- **Fastify** (embedded in-process) as the backend API
- **Drizzle ORM + SQLite** for type-safe database access
- **Server-Sent Events (SSE)** for real-time updates
- **Automatic sync** when connectivity is restored (Phase 2)

### Key Design Principles

```
┌─────────────────────────────────────────────────────────────────┐
│                      DESIGN PRINCIPLES                          │
├─────────────────────────────────────────────────────────────────┤
│  ✓ Offline-First    → Works without internet                    │
│  ✓ Multi-Tenant     → Complete data isolation per business      │
│  ✓ Embedded Backend → Fastify runs in-process (no binary)       │
│  ✓ Cross-Platform   → Windows, macOS, Linux                     │
│  ✓ Auto-Updates     → Seamless updates via GitHub Releases      │
│  ✓ Type-Safe        → Drizzle ORM + TypeScript end-to-end       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture Diagrams

### High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           OPEN YOJOB DESKTOP APP                         │
│                            (Electron Forge)                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                        RENDERER PROCESS                            │  │
│  │                         (Chromium)                                 │  │
│  │  ┌──────────────────────────────────────────────────────────────┐  │  │
│  │  │                     React Application                        │  │  │
│  │  │                                                              │  │  │
│  │  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │  │  │
│  │  │   │   Pages/    │  │  Components │  │   State Management  │  │  │  │
│  │  │   │   Routes    │  │  (Reusable) │  │  (Zustand + Query)  │  │  │  │
│  │  │   └─────────────┘  └─────────────┘  └─────────────────────┘  │  │  │
│  │  │                                                              │  │  │
│  │  │   ┌─────────────────────────────────────────────────────┐    │  │  │
│  │  │   │               Services Layer                        │    │  │  │
│  │  │   │  • API Client (fetch-based REST + SSE)              │    │  │  │
│  │  │   │  • Real-time Service (Server-Sent Events)           │    │  │  │
│  │  │   │  • Sync Service (conflict resolution)               │    │  │  │
│  │  │   └─────────────────────────────────────────────────────┘    │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                              IPC Bridge                                  │
│                          (Context Isolation)                             │
│                                    │                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                        PRELOAD SCRIPT                              │  │
│  │   Exposes safe APIs: electronAPI.getVersion(), getServerUrl()      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                         MAIN PROCESS                               │  │
│  │                          (Node.js)                                 │  │
│  │                                                                    │  │
│  │   ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │  │
│  │   │  Window      │  │  Auto        │  │  Fastify Server        │  │  │
│  │   │  Management  │  │  Updater     │  │  (In-Process)          │  │  │
│  │   └──────────────┘  └──────────────┘  └────────────────────────┘  │  │
│  │                                                │                   │  │
│  │   ┌──────────────────────────────────────┐    │                   │  │
│  │   │  @open-yojob/server Package          │◄───┘                   │  │
│  │   │  • Drizzle ORM + SQLite              │                        │  │
│  │   │  • Auth Routes (JWT + argon2)        │                        │  │
│  │   │  • Collections CRUD                  │                        │  │
│  │   │  • Sync Queue                        │                        │  │
│  │   │  • SSE Real-time                     │                        │  │
│  │   └──────────────────────────────────────┘                        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

                           API: http://127.0.0.1:8090

  ┌──────────────────────────────────────────────────────────────────────┐
  │                        API ENDPOINTS                                 │
  ├──────────────────────────────────────────────────────────────────────┤
  │  /api/auth/*          → Authentication (login, logout, refresh)     │
  │  /api/collections/*   → CRUD operations with tenant isolation       │
  │  /api/sync/*          → Local sync queue (external sync Phase 2)    │
  │  /api/realtime/*      → Server-Sent Events subscriptions            │
  │  /health              → Health check                                │
  └──────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
open_yojob/
│
├── apps/
│   ├── desktop/                     # 🖥️ ELECTRON FORGE APP
│   │   ├── forge.config.ts          # Electron Forge configuration
│   │   ├── package.json             # Desktop app dependencies
│   │   ├── vite.main.config.ts      # Vite config for main process
│   │   ├── vite.preload.config.ts   # Vite config for preload
│   │   ├── vite.renderer.config.ts  # Vite config for renderer
│   │   └── src/
│   │       ├── main/                # ⚡ MAIN PROCESS
│   │       │   ├── index.ts         # Entry point + embedded server
│   │       │   └── auto-updater.ts  # GitHub releases auto-update
│   │       ├── preload/             # 🔒 PRELOAD (IPC BRIDGE)
│   │       │   ├── index.ts         # Context bridge APIs
│   │       │   └── index.d.ts       # TypeScript declarations
│   │       └── renderer/            # 🎨 RENDERER (React)
│   │           ├── App.tsx
│   │           ├── index.tsx
│   │           └── index.css
│   └── web/                         # 🌐 STANDALONE WEB APP
│       └── src/
│           ├── components/
│           ├── features/
│           ├── services/api/        # API client (shared with desktop)
│           └── hooks/
│
├── packages/
│   └── server/                      # 📦 @open-yojob/server PACKAGE
│       ├── package.json
│       ├── drizzle.config.ts        # Drizzle ORM configuration
│       └── src/
│           ├── index.ts             # Server factory (createServer)
│           ├── standalone.ts        # Standalone entry point
│           ├── db/
│           │   ├── schema.ts        # Drizzle schema definitions
│           │   ├── index.ts         # Database initialization
│           │   └── seed.ts          # Default data seeding
│           ├── routes/
│           │   ├── auth.ts          # Authentication (JWT + argon2)
│           │   ├── collections.ts   # Generic CRUD with tenant isolation
│           │   └── sync.ts          # Sync queue management
│           └── realtime/
│               └── sse.ts           # Server-Sent Events
│   │       └── renderer/            # 🎨 RENDERER (REACT UI)
│   │           ├── App.tsx          # Root React component
│   │           ├── index.tsx        # React entry point
│   │           └── index.css        # Tailwind v4 theme config
│   │
│   └── web/                         # 🌐 WEB APP (SHARED COMPONENTS)
│       ├── vite.config.ts           # Vite + Tailwind v4 plugin
│       └── src/
│           ├── index.css            # Tailwind v4 @theme configuration
│           ├── lib/
│           │   └── utils.ts         # cn() helper (clsx + tailwind-merge v3)
│           ├── components/          # Reusable UI components
│           │   ├── ui/              # CVA-based primitives (Button, Input, Card, etc.)
│           │   ├── form-controls/   # Complex form components
│           │   ├── layout/          # Layout components
│           │   └── tables/          # DataTable, exports (CSV, PDF)
│           ├── features/            # Feature modules
│           │   ├── auth/            # Authentication
│           │   ├── customers/       # Customer management
│           │   ├── dashboard/       # Dashboard views
│           │   ├── inventory/       # Inventory tracking
│           │   ├── products/        # Product catalog
│           │   ├── sales/           # Sales & transactions
│           │   └── tenant/          # Multi-tenant management
│           ├── hooks/               # Custom React hooks
│           ├── services/            # API & storage services
│           └── types/               # TypeScript type definitions
│
├── backend/                         # 🔧 CUSTOM POCKETBASE (GO)
│   ├── go.mod                       # Go module definition
│   ├── cmd/server/
│   │   ├── main.go                  # PocketBase custom server
│   │   ├── middleware.go            # CORS, logging middleware
│   │   ├── sync.go                  # Sync API endpoints
│   │   └── tenant.go                # Multi-tenant isolation
│   └── migrations/
│       └── 1706000000_initial.go    # Database schema migrations
│
├── scripts/
│   ├── download-pocketbase.sh       # Download PocketBase binaries
│   └── migration/                   # Legacy data migration tools
│
├── .github/workflows/
│   └── build.yml                    # CI/CD pipeline
│
└── docs/
    └── ARCHITECTURE.md              # This file
```

### Process Communication Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         COMMUNICATION FLOW                              │
└─────────────────────────────────────────────────────────────────────────┘

  RENDERER (React)                PRELOAD              MAIN (Node.js)
       │                             │                       │
       │  window.electronAPI         │                       │
       │  ────────────────────────►  │                       │
       │                             │  ipcRenderer.invoke   │
       │                             │  ──────────────────►  │
       │                             │                       │
       │                             │                       │  Handles:
       │                             │                       │  • get-app-version
       │                             │                       │  • get-pocketbase-url
       │                             │  result               │  • sync operations
       │                             │  ◄──────────────────  │
       │  Promise<result>            │                       │
       │  ◄────────────────────────  │                       │
       │                             │                       │
       │                                                     │
       │  HTTP/REST (direct)                                 │
       │  ─────────────────────────────────────────────────► │ PocketBase
       │                                                     │ localhost:8090
       │  JSON response                                      │
       │  ◄───────────────────────────────────────────────── │
       │                             │                       │
```

### Offline-First Data Sync Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    OFFLINE-FIRST SYNC ARCHITECTURE                      │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │     User Action      │
                    │   (Create/Update)    │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Check Connectivity │
                    └──────────┬───────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
    ┌─────────────────┐               ┌─────────────────┐
    │    ONLINE       │               │    OFFLINE      │
    └────────┬────────┘               └────────┬────────┘
             │                                  │
             ▼                                  ▼
    ┌─────────────────┐               ┌─────────────────┐
    │  Send to        │               │  Save to Local  │
    │  PocketBase     │               │  SQLite + Queue │
    └────────┬────────┘               └────────┬────────┘
             │                                  │
             ▼                                  ▼
    ┌─────────────────┐               ┌─────────────────┐
    │  Update Local   │               │  Mark as        │
    │  Cache          │               │  "Pending Sync" │
    └────────┬────────┘               └────────┬────────┘
             │                                  │
             └──────────────┬───────────────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   When Back Online   │
                 │   (Connectivity Evt) │
                 └──────────┬───────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │   Process Sync Queue │
                 │   (FIFO Order)       │
                 └──────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
    ┌─────────────────┐         ┌─────────────────┐
    │    SUCCESS      │         │    CONFLICT     │
    │  Remove from    │         │  Last-Write or  │
    │  Queue          │         │  Manual Resolve │
    └─────────────────┘         └─────────────────┘
```

### Multi-Tenant Data Isolation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     MULTI-TENANT DATA ISOLATION                         │
└─────────────────────────────────────────────────────────────────────────┘

  Request with X-Tenant-ID header
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         POCKETBASE SERVER                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    Middleware Layer                              │  │
│   │   • Extract tenant_id from header or auth token                  │  │
│   │   • Validate tenant access permissions                           │  │
│   │   • Inject tenant filter into all queries                        │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                                    ▼                                    │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                         Database                                │   │
│   │                                                                 │   │
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │   │
│   │  │   Tenant A      │  │   Tenant B      │  │   Tenant C      │ │   │
│   │  │   Products: 50  │  │   Products: 120 │  │   Products: 30  │ │   │
│   │  │   Sales: 1000   │  │   Sales: 5000   │  │   Sales: 200    │ │   │
│   │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │   │
│   │                                                                 │   │
│   │   Every record has tenant_id → Complete isolation guaranteed    │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Deep Dive

### Main Process (`apps/desktop/src/main/`)

| File              | Responsibility                                             |
| ----------------- | ---------------------------------------------------------- |
| `index.ts`        | App lifecycle, window creation, IPC handlers               |
| `pocketbase.ts`   | Spawn/manage PocketBase as child process, health checks    |
| `auto-updater.ts` | Check for updates from GitHub Releases, download & install |
| `database.ts`     | Local SQLite (better-sqlite3) for offline data persistence |
| `sync.ts`         | Queue management, conflict resolution, sync orchestration  |

### Preload Script (`apps/desktop/src/preload/`)

The preload script acts as a **secure bridge** between the renderer and main processes:

```typescript
// Exposed APIs (via contextBridge)
window.electronAPI = {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getPocketBaseUrl: () => ipcRenderer.invoke('get-pocketbase-url'),
};
```

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

### UI Component Architecture (`apps/web/src/components/`)

```
components/
├── ui/                   # 🎨 Primitive UI components (CVA-based)
│   ├── Button.tsx        # Button variants: primary, secondary, outline, ghost, destructive
│   ├── Input.tsx         # Input with label, error states, prefix/suffix
│   ├── Label.tsx         # Form labels with variant support
│   ├── Badge.tsx         # Status badges: success, warning, danger
│   ├── Card.tsx          # Card compound components
│   ├── Table.tsx         # Table compound components
│   └── index.ts          # Barrel export
├── form-controls/        # 📝 Complex form components
│   ├── Select.tsx
│   ├── Checkbox.tsx
│   ├── DatePicker.tsx
│   ├── FormField.tsx
│   └── Modal.tsx
├── layout/               # 📐 Layout components
│   └── ...
└── tables/               # 📊 Data table components
    └── ...
```

### Styling Architecture

The project uses **Tailwind CSS v4** with the native Vite plugin and **CVA (class-variance-authority)** for component variants:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       STYLING ARCHITECTURE                              │
└─────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
  │  Tailwind CSS v4 │    │       CVA        │    │  tailwind-merge  │
  │  (Vite Plugin)   │ +  │  (Variants API)  │ +  │  (Class Merging) │
  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
           │                       │                       │
           ▼                       ▼                       ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                        Component Example                            │
  │                                                                     │
  │  const buttonVariants = cva(                                        │
  │    "inline-flex items-center justify-center rounded-md ...",        │
  │    {                                                                │
  │      variants: {                                                    │
  │        variant: { primary: "bg-primary-500", ghost: "bg-transparent" },│
  │        size: { sm: "h-8 px-3", lg: "h-12 px-6" }                   │
  │      },                                                             │
  │      defaultVariants: { variant: "primary", size: "default" }       │
  │    }                                                                │
  │  );                                                                 │
  │                                                                     │
  │  <Button variant="primary" size="lg" className="custom-class" />    │
  └─────────────────────────────────────────────────────────────────────┘
```

Key styling files:

- **`index.css`**: Theme configuration via `@theme` block (colors, fonts, spacing)
- **`lib/utils.ts`**: `cn()` utility combining `clsx` + `tailwind-merge`
- **`components/ui/*.tsx`**: CVA-based primitive components

See **[docs/STYLING.md](./STYLING.md)** for detailed styling guidelines.

### Backend (`backend/`)

Custom PocketBase extensions in Go:

| File                       | Purpose                          |
| -------------------------- | -------------------------------- |
| `cmd/server/main.go`       | Custom PocketBase initialization |
| `cmd/server/tenant.go`     | Tenant isolation hooks           |
| `cmd/server/sync.go`       | Custom sync endpoints            |
| `cmd/server/middleware.go` | CORS configuration               |
| `migrations/*.go`          | Database schema migrations       |

---

## Data Flow

### Typical Create Operation

```
1. User fills form in React UI
         │
         ▼
2. Form submission triggers mutation (TanStack Query)
         │
         ▼
3. Service layer calls PocketBase API
         │
         ├─── Online: POST /api/collections/{name}/records
         │              │
         │              ▼
         │         PocketBase validates & saves to SQLite
         │              │
         │              ▼
         │         Returns created record with ID
         │
         └─── Offline: Save to local SQLite + add to sync queue
                       │
                       ▼
                  When online: Sync service processes queue
```

### Authentication Flow

```
1. User enters credentials
         │
         ▼
2. POST /api/collections/users/auth-with-password
         │
         ▼
3. PocketBase validates credentials
         │
         ├─── Success: Returns JWT token + user record
         │              │
         │              ▼
         │         Store token in Zustand state
         │              │
         │              ▼
         │         Set X-Tenant-ID header for future requests
         │
         └─── Failure: Display error message
```

---

## How to Run

### Prerequisites

```bash
# Required
node --version   # >= 20.0.0
npm --version    # >= 10.0.0

# For backend development only
go version       # >= 1.23
```

### Development Mode

```bash
# 1. Clone and install
git clone https://github.com/johnny4young/open_yojob.git
cd open_yojob
npm install

# 2. Download PocketBase binaries (one-time)
./scripts/download-pocketbase.sh

# 3. Start the desktop app in dev mode
cd apps/desktop
npm start
```

This will:

- Start Vite dev server for hot reload
- Launch Electron window
- Auto-start embedded PocketBase at `http://127.0.0.1:8090`

### Running Web App Only (for UI development)

```bash
cd apps/web
npm run dev
# Opens at http://localhost:5173
# Note: Requires PocketBase running separately or mocked
```

### Building for Production

```bash
cd apps/desktop

# Package (creates unpacked app)
npm run package

# Make installers (platform-specific)
npm run make

# Outputs in ./out/make/
# - Windows: .exe installer (Squirrel)
# - macOS: .zip (for notarization)
# - Linux: .deb, .rpm
```

---

## How to Debug

### 1. Main Process Debugging

**VS Code Configuration** (`.vscode/launch.json`):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Electron Main",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}/apps/desktop",
      "runtimeExecutable": "${workspaceFolder}/apps/desktop/node_modules/.bin/electron-forge",
      "args": ["start", "--inspect-brk"],
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/apps/desktop/.vite/**/*.js"]
    }
  ]
}
```

Or via terminal:

```bash
npm start -- --inspect-brk
# Then attach Chrome DevTools to chrome://inspect
```

### 2. Renderer Process Debugging

- **DevTools**: Press `Ctrl+Shift+I` (or `Cmd+Option+I` on macOS) in the app
- **React DevTools**: Install the browser extension, it works in Electron
- **Console logs**: Visible in DevTools Console tab

### 3. PocketBase Debugging

```bash
# View PocketBase logs in terminal where app is running
# Or access admin dashboard:
open http://127.0.0.1:8090/_/

# Default admin credentials created on first run
```

### 4. Common Debug Scenarios

| Issue                  | Debug Approach                                           |
| ---------------------- | -------------------------------------------------------- |
| PocketBase won't start | Check `pocketbase.ts` logs, verify binary exists         |
| IPC not working        | Check preload script, verify contextIsolation            |
| Data not syncing       | Check `sync.ts`, inspect sync queue in local SQLite      |
| UI not updating        | Check TanStack Query devtools, verify cache invalidation |
| Auth issues            | Check JWT token in Zustand state, verify tenant_id       |

### 5. Useful Debug Commands

```bash
# Check TypeScript errors
npm run typecheck

# Run linter
npm run lint

# Format code
npm run format:fix

# Check for outdated dependencies
npm outdated
```

---

## Development Workflow

### Adding a New Feature

1. **Create feature module** in `apps/web/src/features/{feature-name}/`
2. **Define types** in `apps/web/src/types/`
3. **Create PocketBase collection** via Admin UI or migration
4. **Add API service** in feature module
5. **Create React components** with TanStack Query hooks
6. **Add route** in App.tsx

### Code Quality Checks

```bash
# Before committing
npm run lint        # ESLint
npm run format      # Prettier check
npm run typecheck   # TypeScript
npm run test        # Unit tests (web app)
```

### Git Workflow

```
main
  │
  └── feature/your-feature
        │
        └── Commit small, logical changes
              │
              └── PR → Review → Merge
```

---

## Considerations

### Security

| Aspect            | Implementation                                     |
| ----------------- | -------------------------------------------------- |
| Context Isolation | Enabled - renderer cannot access Node.js directly  |
| Node Integration  | Disabled in renderer                               |
| Sandbox           | Disabled (needed for better-sqlite3 native module) |
| CORS              | Configured for localhost only                      |
| Auth Tokens       | Stored in memory (Zustand), not localStorage       |

### Performance

| Area            | Strategy                                   |
| --------------- | ------------------------------------------ |
| Table Rendering | TanStack Virtual for large datasets        |
| API Caching     | TanStack Query with stale-while-revalidate |
| Bundle Size     | Vite tree-shaking, code splitting          |
| Startup Time    | Lazy load non-critical features            |

### Offline Support

- **Queue System**: Pending operations stored in local SQLite
- **Conflict Resolution**: Last-write-wins (configurable)
- **Data Priority**: Critical data (sales) synced first
- **Connectivity Detection**: Native Electron APIs

---

## Limitations

### Current Limitations

| Limitation                 | Reason / Workaround                                 |
| -------------------------- | --------------------------------------------------- |
| Windows only auto-updates  | Squirrel.Windows; macOS needs notarization setup    |
| No real-time collaboration | PocketBase realtime available but not implemented   |
| Single-machine only        | Designed as desktop app, not networked              |
| English-only UI            | i18n framework not yet integrated                   |
| No barcode scanner support | Planned for future release                          |
| Limited report exports     | CSV, Excel, PDF available; no custom report builder |

### Technical Debt

- [ ] Add comprehensive unit tests for main process
- [ ] Implement E2E tests with Playwright
- [ ] Add error boundary and crash reporting
- [ ] Implement proper logging system (Winston/Pino)
- [ ] Add telemetry (opt-in)

### Platform-Specific Notes

| Platform | Notes                                           |
| -------- | ----------------------------------------------- |
| Windows  | Requires code signing for auto-updates          |
| macOS    | Requires notarization for Gatekeeper approval   |
| Linux    | Tested on Ubuntu/Debian; other distros may vary |

---

## Quick Reference

### Key URLs (Development)

| Service          | URL                        |
| ---------------- | -------------------------- |
| Electron App     | Launches as desktop window |
| Web Dev Server   | http://localhost:5173      |
| PocketBase API   | http://127.0.0.1:8090/api/ |
| PocketBase Admin | http://127.0.0.1:8090/_/   |

### Key Commands

```bash
# Desktop app
cd apps/desktop
npm start           # Development
npm run make        # Build installers
npm run lint        # Lint code

# Web app
cd apps/web
npm run dev         # Development
npm run test        # Run tests
npm run build       # Production build

# Backend (if customizing PocketBase)
cd backend
go run ./cmd/server # Run custom PocketBase
go test ./...       # Run Go tests
```

### Environment Variables

| Variable              | Purpose                     | Default       |
| --------------------- | --------------------------- | ------------- |
| `DISABLE_AUTO_UPDATE` | Skip auto-update checks     | `false`       |
| `POCKETBASE_PORT`     | PocketBase server port      | `8090`        |
| `NODE_ENV`            | Development/production mode | `development` |

---

## Need Help?

1. **Read the code** - It's well-commented
2. **Check existing issues** on GitHub
3. **Ask questions** in Discussions
4. **Review PRs** to understand recent changes

Welcome to the project! 🎉
