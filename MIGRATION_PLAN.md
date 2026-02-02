# Migration Plan: .NET WinForms to Modern Web Application

> **⚠️ STATUS UPDATE (2025)**: The backend has been migrated from PocketBase (Go) to **Node.js/Fastify + Drizzle ORM**. This document reflects the original migration plan. See [README.md](README.md) for the current architecture.

## Overview

This document outlines the migration strategy from a .NET WinForms desktop application to a modern web application with Electron support for desktop deployment.

## Target Technology Stack

| Layer             | Technology     |
| ----------------- | -------------- |
| Frontend          | ReactJS        |
| Styling           | Tailwind CSS   |
| Data Tables       | TanStack Table |
| Backend           | Golang         |
| Backend Framework | PocketBase     |
| Database          | SQLite         |
| Desktop           | Electron       |

## Architecture Requirements

### Multi-Tenant Architecture

- Preserve existing multi-tenant architecture patterns
- Tenant isolation at data and application levels
- Configurable tenant-specific features and branding

### Offline Support

- Full offline functionality using SQLite local storage
- Background sync when connectivity is restored
- Conflict resolution strategies for data synchronization

---

## Phase 1: Foundation Setup

### 1.1 Project Initialization

- [ ] Initialize ReactJS project with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up Electron shell
- [ ] Configure build pipelines for web and desktop targets

### 1.2 Backend Setup

- [ ] Initialize Golang project structure
- [ ] Set up PocketBase integration
- [ ] Configure SQLite database schema
- [ ] Implement multi-tenant data isolation

### 1.3 Core Infrastructure

- [ ] Authentication and authorization system
- [ ] Tenant context management
- [ ] API client with offline queue support
- [ ] Local storage synchronization layer

---

## Phase 2: Feature Parity - Data Tables

### 2.1 TanStack Table Implementation

- [ ] Set up TanStack Table core configuration
- [ ] Implement column definitions matching existing WinForms grids
- [ ] Add sorting, filtering, and pagination
- [ ] Implement row selection and bulk actions
- [ ] Add column resizing and reordering
- [ ] Implement virtual scrolling for large datasets

### 2.2 Table Features

- [ ] Export functionality (CSV, Excel, PDF)
- [ ] Print support
- [ ] Column visibility toggles
- [ ] Saved table configurations per user
- [ ] Inline editing capabilities

---

## Phase 3: Feature Migration

### 3.1 UI Components

- [ ] Migrate forms and input components
- [ ] Implement navigation structure
- [ ] Create dashboard layouts
- [ ] Build reporting views

### 3.2 Business Logic

- [ ] Port validation rules
- [ ] Migrate calculation logic
- [ ] Implement workflow processes
- [ ] Preserve MEF plugin architecture patterns (if applicable)

### 3.3 Data Management

- [ ] Implement CRUD operations
- [ ] Set up real-time updates
- [ ] Configure data caching strategies

---

## Phase 4: Offline & Sync

### 4.1 Offline Storage

- [ ] Configure SQLite for Electron
- [ ] Implement IndexedDB for web browser support
- [ ] Create offline data access layer

### 4.2 Synchronization

- [ ] Implement background sync service
- [ ] Create conflict detection and resolution
- [ ] Add sync status indicators
- [ ] Implement retry mechanisms with exponential backoff

---

## Phase 5: Testing & Validation

### 5.1 Testing Strategy

- [ ] Unit tests for business logic
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical workflows
- [ ] Offline scenario testing

### 5.2 Feature Parity Validation

- [ ] Create feature comparison checklist
- [ ] User acceptance testing
- [ ] Performance benchmarking against WinForms app

---

## Phase 6: Deployment & Migration

### 6.1 Deployment Setup

- [ ] Configure CI/CD pipelines
- [ ] Set up staging environments
- [ ] Prepare production infrastructure

### 6.2 Data Migration

- [ ] Create data migration scripts
- [ ] Plan rollback procedures
- [ ] Schedule migration windows

### 6.3 Rollout Strategy

- [ ] Pilot with select tenants
- [ ] Phased rollout plan
- [ ] Documentation and training materials

---

## Key Considerations

### Feature Parity Priorities

1. **Data Grid Functionality** - TanStack Table provides feature-rich table capabilities matching WinForms DataGridView
2. **Offline Support** - Critical for field operations
3. **Multi-Tenant Isolation** - Security and data separation requirements

### Risk Mitigation

- Maintain parallel operation during transition
- Incremental feature releases
- Comprehensive testing at each phase

### Success Metrics

- Feature completeness vs. original application
- Performance benchmarks
- User adoption rates
- Sync reliability metrics

---

## Technical Implementation Details

### Frontend Architecture

```
src/
├── components/
│   ├── common/           # Shared UI components
│   ├── tables/           # TanStack Table wrappers
│   ├── forms/            # Form components
│   └── layout/           # Layout components
├── features/
│   ├── auth/             # Authentication module
│   ├── tenant/           # Multi-tenant context
│   ├── sync/             # Offline sync logic
│   └── [domain]/         # Domain-specific features
├── hooks/
│   ├── useOffline.ts     # Offline detection
│   ├── useSync.ts        # Sync operations
│   └── useTenant.ts      # Tenant context
├── services/
│   ├── api/              # API client
│   ├── storage/          # Local storage abstraction
│   └── sync/             # Sync service
├── stores/               # State management
└── utils/                # Utility functions
```

### Backend Architecture (Golang + PocketBase)

```
backend/
├── cmd/
│   └── server/           # Application entry point
├── internal/
│   ├── auth/             # Authentication handlers
│   ├── tenant/           # Multi-tenant middleware
│   ├── handlers/         # HTTP handlers
│   ├── models/           # Data models
│   ├── repository/       # Data access layer
│   └── services/         # Business logic
├── migrations/           # Database migrations
├── pb_hooks/             # PocketBase hooks
└── pb_migrations/        # PocketBase migrations
```

### Electron Structure

```
electron/
├── main/
│   ├── index.ts          # Main process entry
│   ├── database.ts       # SQLite connection
│   ├── sync.ts           # Background sync
│   └── ipc.ts            # IPC handlers
├── preload/
│   └── index.ts          # Preload scripts
└── resources/            # App resources
```

---

## Database Schema Design

### Multi-Tenant Tables Pattern

```sql
-- Base table with tenant isolation
CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sync_status TEXT DEFAULT 'pending',
    sync_version INTEGER DEFAULT 0,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Sync tracking table
CREATE TABLE sync_queue (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,  -- 'create', 'update', 'delete'
    payload TEXT,             -- JSON payload
    tenant_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT
);

-- Conflict resolution log
CREATE TABLE sync_conflicts (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_data TEXT,
    remote_data TEXT,
    resolution TEXT,          -- 'local_wins', 'remote_wins', 'merged'
    resolved_at DATETIME,
    tenant_id TEXT NOT NULL
);
```

---

## API Design

### RESTful Endpoints

```
# Authentication
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh

# Tenant Management
GET    /api/tenants/:id
PUT    /api/tenants/:id/settings

# Sync Endpoints
POST   /api/sync/push              # Push local changes
GET    /api/sync/pull?since=<ts>   # Pull remote changes
POST   /api/sync/resolve           # Resolve conflicts

# Domain Resources (per tenant)
GET    /api/:tenant/resources
POST   /api/:tenant/resources
GET    /api/:tenant/resources/:id
PUT    /api/:tenant/resources/:id
DELETE /api/:tenant/resources/:id
```

### Sync Protocol

```typescript
// Push request
interface SyncPushRequest {
  tenantId: string;
  changes: {
    entityType: string;
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    data: Record<string, unknown>;
    localVersion: number;
  }[];
  clientTimestamp: string;
}

// Pull response
interface SyncPullResponse {
  changes: {
    entityType: string;
    entityId: string;
    operation: 'create' | 'update' | 'delete';
    data: Record<string, unknown>;
    serverVersion: number;
  }[];
  serverTimestamp: string;
  hasMore: boolean;
}
```

---

## TanStack Table Configuration

### Base Table Component

```typescript
// hooks/useDataTable.ts
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
} from '@tanstack/react-table';

interface UseDataTableOptions<T> {
  data: T[];
  columns: ColumnDef<T>[];
  enableRowSelection?: boolean;
  enableColumnResizing?: boolean;
  enableSorting?: boolean;
  enableFiltering?: boolean;
  onRowSelectionChange?: (rows: T[]) => void;
}

export function useDataTable<T>(options: UseDataTableOptions<T>) {
  const table = useReactTable({
    data: options.data,
    columns: options.columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: options.enableRowSelection,
    enableColumnResizing: options.enableColumnResizing,
    columnResizeMode: 'onChange',
  });

  return table;
}
```

### Feature Parity Checklist: WinForms DataGridView → TanStack Table

| WinForms Feature | TanStack Implementation                       |
| ---------------- | --------------------------------------------- |
| Column sorting   | `getSortedRowModel()`                         |
| Column filtering | `getFilteredRowModel()` + custom filter UI    |
| Row selection    | `enableRowSelection` + `onRowSelectionChange` |
| Multi-select     | `enableMultiRowSelection`                     |
| Column reorder   | `@tanstack/react-table` column order state    |
| Column resize    | `enableColumnResizing` + `columnResizeMode`   |
| Virtual scroll   | `@tanstack/react-virtual` integration         |
| Cell editing     | Custom cell renderer with edit mode           |
| Context menu     | Custom right-click handler                    |
| Export to Excel  | `xlsx` library integration                    |
| Print            | Custom print stylesheet + `window.print()`    |

---

## Offline Sync Implementation

### Sync Service

```typescript
// services/sync/SyncService.ts
export class SyncService {
  private syncQueue: SyncQueue;
  private api: ApiClient;
  private storage: LocalStorage;

  async pushChanges(): Promise<SyncResult> {
    const pending = await this.syncQueue.getPending();
    if (pending.length === 0) return { success: true, synced: 0 };

    try {
      const response = await this.api.sync.push({
        tenantId: this.getTenantId(),
        changes: pending,
        clientTimestamp: new Date().toISOString(),
      });

      await this.syncQueue.markSynced(pending.map(p => p.id));
      return { success: true, synced: pending.length };
    } catch (error) {
      await this.handleSyncError(error, pending);
      return { success: false, error };
    }
  }

  async pullChanges(since?: string): Promise<SyncResult> {
    try {
      const response = await this.api.sync.pull({ since });

      for (const change of response.changes) {
        await this.applyRemoteChange(change);
      }

      return { success: true, synced: response.changes.length };
    } catch (error) {
      return { success: false, error };
    }
  }

  private async applyRemoteChange(change: SyncChange): Promise<void> {
    const local = await this.storage.get(change.entityType, change.entityId);

    if (local && local.syncVersion >= change.serverVersion) {
      // Local is newer, potential conflict
      await this.handleConflict(local, change);
      return;
    }

    switch (change.operation) {
      case 'create':
      case 'update':
        await this.storage.upsert(change.entityType, change.entityId, change.data);
        break;
      case 'delete':
        await this.storage.delete(change.entityType, change.entityId);
        break;
    }
  }
}
```

### Conflict Resolution Strategies

```typescript
type ConflictStrategy = 'server_wins' | 'client_wins' | 'last_write_wins' | 'manual';

interface ConflictResolver {
  resolve(local: Entity, remote: Entity, strategy: ConflictStrategy): Entity;
}

// Default: Last write wins based on timestamp
function lastWriteWins(local: Entity, remote: Entity): Entity {
  return new Date(local.updatedAt) > new Date(remote.updatedAt) ? local : remote;
}
```

---

## Environment Configuration

### Development

```env
# .env.development
VITE_API_URL=http://localhost:8090
VITE_ENABLE_OFFLINE=true
VITE_SYNC_INTERVAL=30000
```

### Production

```env
# .env.production
VITE_API_URL=https://api.yourdomain.com
VITE_ENABLE_OFFLINE=true
VITE_SYNC_INTERVAL=60000
```

### Electron

```env
# .env.electron
SQLITE_PATH=./data/local.db
SYNC_ON_STARTUP=true
BACKGROUND_SYNC=true
```

---

## Timeline Estimates

| Phase                      | Duration  | Dependencies |
| -------------------------- | --------- | ------------ |
| Phase 1: Foundation        | 3-4 weeks | None         |
| Phase 2: Data Tables       | 2-3 weeks | Phase 1      |
| Phase 3: Feature Migration | 6-8 weeks | Phase 2      |
| Phase 4: Offline & Sync    | 3-4 weeks | Phase 1, 3   |
| Phase 5: Testing           | 2-3 weeks | Phase 3, 4   |
| Phase 6: Deployment        | 2-3 weeks | Phase 5      |

**Total Estimated Duration: 18-25 weeks**

---

## Next Steps

1. **Immediate Actions**
   - [ ] Set up monorepo structure (frontend, backend, electron)
   - [ ] Initialize React + Vite + TypeScript project
   - [ ] Configure Tailwind CSS with design system tokens
   - [ ] Set up PocketBase development instance

2. **Week 1 Deliverables**
   - [ ] Project scaffolding complete
   - [ ] Basic authentication flow
   - [ ] First TanStack Table prototype
   - [ ] SQLite integration in Electron

3. **First Milestone (Week 4)**
   - [ ] Core infrastructure operational
   - [ ] Multi-tenant context working
   - [ ] Basic CRUD with offline queue
   - [ ] Proof-of-concept sync

---

## Detailed Component Specifications

### Authentication Module

```typescript
// features/auth/AuthProvider.tsx
interface AuthContext {
  user: User | null;
  tenant: Tenant | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

// features/auth/hooks/useAuth.ts
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// features/auth/services/authService.ts
export class AuthService {
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await this.api.post('/auth/login', credentials);
    await this.storage.setToken(response.token);
    await this.storage.setRefreshToken(response.refreshToken);
    return response;
  }

  async refreshToken(): Promise<string> {
    const refreshToken = await this.storage.getRefreshToken();
    const response = await this.api.post('/auth/refresh', { refreshToken });
    await this.storage.setToken(response.token);
    return response.token;
  }

  async logout(): Promise<void> {
    await this.api.post('/auth/logout');
    await this.storage.clearAuth();
  }
}
```

### Multi-Tenant Context

```typescript
// features/tenant/TenantProvider.tsx
interface TenantContext {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  switchTenant: (tenantId: string) => Promise<void>;
  tenantSettings: TenantSettings;
}

// features/tenant/hooks/useTenant.ts
export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within TenantProvider');
  return context;
}

// Tenant-aware API client
export class TenantAwareApiClient {
  private tenantId: string | null = null;

  setTenant(tenantId: string) {
    this.tenantId = tenantId;
  }

  async request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    const url = this.tenantId ? `/api/${this.tenantId}${endpoint}` : `/api${endpoint}`;

    return this.fetch<T>(url, {
      ...options,
      headers: {
        ...options?.headers,
        'X-Tenant-ID': this.tenantId || '',
      },
    });
  }
}
```

### Offline Detection Hook

```typescript
// hooks/useOffline.ts
export function useOffline() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [lastOnline, setLastOnline] = useState<Date | null>(null);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setLastOnline(new Date());
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOffline, lastOnline };
}
```

### Sync Status Component

```typescript
// components/common/SyncStatus.tsx
interface SyncStatusProps {
  className?: string;
}

export function SyncStatus({ className }: SyncStatusProps) {
  const { isOffline } = useOffline();
  const { pendingCount, lastSyncTime, isSyncing, syncNow } = useSync();

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {isOffline ? (
        <Badge variant="warning">
          <WifiOff className="w-3 h-3 mr-1" />
          Offline
        </Badge>
      ) : isSyncing ? (
        <Badge variant="info">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Syncing...
        </Badge>
      ) : pendingCount > 0 ? (
        <Badge variant="warning" onClick={syncNow}>
          <CloudUpload className="w-3 h-3 mr-1" />
          {pendingCount} pending
        </Badge>
      ) : (
        <Badge variant="success">
          <CheckCircle className="w-3 h-3 mr-1" />
          Synced
        </Badge>
      )}
      {lastSyncTime && (
        <span className="text-xs text-muted-foreground">
          Last sync: {formatRelativeTime(lastSyncTime)}
        </span>
      )}
    </div>
  );
}
```

---

## State Management

### Zustand Store Configuration

```typescript
// stores/appStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AppState {
  // UI State
  sidebarOpen: boolean;
  theme: 'light' | 'dark' | 'system';

  // Actions
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      sidebarOpen: true,
      theme: 'system',
      toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: theme => set({ theme }),
    }),
    {
      name: 'app-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// stores/syncStore.ts
interface SyncState {
  pendingChanges: SyncQueueItem[];
  lastSyncTime: Date | null;
  isSyncing: boolean;
  syncErrors: SyncError[];

  addPendingChange: (change: SyncQueueItem) => void;
  removePendingChanges: (ids: string[]) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time: Date) => void;
  addSyncError: (error: SyncError) => void;
  clearSyncErrors: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    set => ({
      pendingChanges: [],
      lastSyncTime: null,
      isSyncing: false,
      syncErrors: [],

      addPendingChange: change =>
        set(state => ({
          pendingChanges: [...state.pendingChanges, change],
        })),
      removePendingChanges: ids =>
        set(state => ({
          pendingChanges: state.pendingChanges.filter(c => !ids.includes(c.id)),
        })),
      setSyncing: syncing => set({ isSyncing: syncing }),
      setLastSyncTime: time => set({ lastSyncTime: time }),
      addSyncError: error => set(state => ({ syncErrors: [...state.syncErrors, error] })),
      clearSyncErrors: () => set({ syncErrors: [] }),
    }),
    {
      name: 'sync-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

### TanStack Query Configuration

```typescript
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: 3,
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
      networkMode: 'offlineFirst',
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 3,
    },
  },
});

// Persist cache for offline support
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'query-cache',
});

persistQueryClient({
  queryClient,
  persister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
});
```

---

## Electron Integration

### Main Process Setup

```typescript
// electron/main/index.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { Database } from './database';
import { SyncManager } from './sync';

let mainWindow: BrowserWindow | null = null;
let database: Database;
let syncManager: SyncManager;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Initialize database
  database = new Database(app.getPath('userData'));
  await database.initialize();

  // Initialize sync manager
  syncManager = new SyncManager(database);
  await syncManager.start();

  // Load app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

// IPC handlers
ipcMain.handle('db:query', async (_, sql, params) => {
  return database.query(sql, params);
});

ipcMain.handle('db:execute', async (_, sql, params) => {
  return database.execute(sql, params);
});

ipcMain.handle('sync:trigger', async () => {
  return syncManager.syncNow();
});

ipcMain.handle('sync:status', async () => {
  return syncManager.getStatus();
});
```

### SQLite Database Manager

```typescript
// electron/main/database.ts
import Database from 'better-sqlite3';
import path from 'path';

export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(userDataPath: string) {
    this.dbPath = path.join(userDataPath, 'local.db');
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    await this.runMigrations();
  }

  private async runMigrations(): Promise<void> {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT,
        tenant_id TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        retry_count INTEGER DEFAULT 0
      )`,
      // Add domain-specific tables...
    ];

    const transaction = this.db.transaction(() => {
      for (const migration of migrations) {
        this.db.exec(migration);
      }
    });

    transaction();
  }

  query<T>(sql: string, params?: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return params ? (stmt.all(...params) as T[]) : (stmt.all() as T[]);
  }

  execute(sql: string, params?: unknown[]): Database.RunResult {
    const stmt = this.db.prepare(sql);
    return params ? stmt.run(...params) : stmt.run();
  }

  close(): void {
    this.db.close();
  }
}
```

### Preload Script

```typescript
// electron/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    execute: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:execute', sql, params),
  },

  // Sync operations
  sync: {
    trigger: () => ipcRenderer.invoke('sync:trigger'),
    getStatus: () => ipcRenderer.invoke('sync:status'),
    onStatusChange: (callback: (status: SyncStatus) => void) => {
      ipcRenderer.on('sync:status-changed', (_, status) => callback(status));
    },
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    getPlatform: () => process.platform,
  },
});

// Type declarations for renderer
declare global {
  interface Window {
    electronAPI: {
      db: {
        query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
        execute: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
      };
      sync: {
        trigger: () => Promise<SyncResult>;
        getStatus: () => Promise<SyncStatus>;
        onStatusChange: (callback: (status: SyncStatus) => void) => void;
      };
      app: {
        getVersion: () => Promise<string>;
        getPlatform: () => string;
      };
    };
  }
}
```

---

## PocketBase Backend Extensions

### Custom Hooks

```go
// pb_hooks/main.go
package main

import (
    "github.com/pocketbase/pocketbase"
    "github.com/pocketbase/pocketbase/core"
)

func main() {
    app := pocketbase.New()

    // Multi-tenant middleware
    app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
        e.Router.Use(tenantMiddleware(app))
        return nil
    })

    // Sync endpoints
    app.OnBeforeServe().Add(func(e *core.ServeEvent) error {
        e.Router.POST("/api/sync/push", syncPushHandler(app))
        e.Router.GET("/api/sync/pull", syncPullHandler(app))
        return nil
    })

    // Record hooks for sync versioning
    app.OnRecordBeforeCreateRequest().Add(func(e *core.RecordCreateEvent) error {
        e.Record.Set("sync_version", 1)
        e.Record.Set("updated_at", time.Now().UTC())
        return nil
    })

    app.OnRecordBeforeUpdateRequest().Add(func(e *core.RecordUpdateEvent) error {
        currentVersion := e.Record.GetInt("sync_version")
        e.Record.Set("sync_version", currentVersion+1)
        e.Record.Set("updated_at", time.Now().UTC())
        return nil
    })

    if err := app.Start(); err != nil {
        log.Fatal(err)
    }
}
```

### Tenant Middleware

```go
// pb_hooks/tenant.go
package main

import (
    "github.com/labstack/echo/v5"
    "github.com/pocketbase/pocketbase"
)

func tenantMiddleware(app *pocketbase.PocketBase) echo.MiddlewareFunc {
    return func(next echo.HandlerFunc) echo.HandlerFunc {
        return func(c echo.Context) error {
            tenantID := c.Request().Header.Get("X-Tenant-ID")
            if tenantID == "" {
                tenantID = c.Param("tenant")
            }

            if tenantID != "" {
                // Validate tenant exists and user has access
                tenant, err := app.Dao().FindRecordById("tenants", tenantID)
                if err != nil {
                    return echo.NewHTTPError(404, "Tenant not found")
                }

                c.Set("tenant", tenant)
                c.Set("tenantId", tenantID)
            }

            return next(c)
        }
    }
}
```

### Sync Handlers

```go
// pb_hooks/sync.go
package main

import (
    "encoding/json"
    "net/http"
    "time"

    "github.com/labstack/echo/v5"
    "github.com/pocketbase/pocketbase"
)

type SyncPushRequest struct {
    TenantID        string       `json:"tenantId"`
    Changes         []SyncChange `json:"changes"`
    ClientTimestamp string       `json:"clientTimestamp"`
}

type SyncChange struct {
    EntityType   string                 `json:"entityType"`
    EntityID     string                 `json:"entityId"`
    Operation    string                 `json:"operation"`
    Data         map[string]interface{} `json:"data"`
    LocalVersion int                    `json:"localVersion"`
}

func syncPushHandler(app *pocketbase.PocketBase) echo.HandlerFunc {
    return func(c echo.Context) error {
        var req SyncPushRequest
        if err := c.Bind(&req); err != nil {
            return echo.NewHTTPError(400, "Invalid request")
        }

        results := make([]map[string]interface{}, 0)

        for _, change := range req.Changes {
            result, err := processChange(app, req.TenantID, change)
            if err != nil {
                results = append(results, map[string]interface{}{
                    "entityId": change.EntityID,
                    "success":  false,
                    "error":    err.Error(),
                })
                continue
            }
            results = append(results, result)
        }

        return c.JSON(http.StatusOK, map[string]interface{}{
            "results":         results,
            "serverTimestamp": time.Now().UTC().Format(time.RFC3339),
        })
    }
}

func syncPullHandler(app *pocketbase.PocketBase) echo.HandlerFunc {
    return func(c echo.Context) error {
        tenantID := c.Get("tenantId").(string)
        since := c.QueryParam("since")

        var sinceTime time.Time
        if since != "" {
            sinceTime, _ = time.Parse(time.RFC3339, since)
        }

        changes, err := getChangesSince(app, tenantID, sinceTime)
        if err != nil {
            return echo.NewHTTPError(500, "Failed to fetch changes")
        }

        return c.JSON(http.StatusOK, map[string]interface{}{
            "changes":         changes,
            "serverTimestamp": time.Now().UTC().Format(time.RFC3339),
            "hasMore":         false,
        })
    }
}
```

---

## Testing Strategy

### Unit Test Examples

```typescript
// __tests__/services/syncService.test.ts
import { SyncService } from '@/services/sync/SyncService';
import { mockApi, mockStorage, mockSyncQueue } from '../mocks';

describe('SyncService', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService(mockApi, mockStorage, mockSyncQueue);
  });

  describe('pushChanges', () => {
    it('should push pending changes to server', async () => {
      const pendingChanges = [
        { id: '1', entityType: 'users', operation: 'update', data: { name: 'Test' } },
      ];
      mockSyncQueue.getPending.mockResolvedValue(pendingChanges);
      mockApi.sync.push.mockResolvedValue({ success: true });

      const result = await syncService.pushChanges();

      expect(result.success).toBe(true);
      expect(result.synced).toBe(1);
      expect(mockSyncQueue.markSynced).toHaveBeenCalledWith(['1']);
    });

    it('should handle empty queue', async () => {
      mockSyncQueue.getPending.mockResolvedValue([]);

      const result = await syncService.pushChanges();

      expect(result.success).toBe(true);
      expect(result.synced).toBe(0);
      expect(mockApi.sync.push).not.toHaveBeenCalled();
    });
  });

  describe('conflict resolution', () => {
    it('should use last-write-wins by default', async () => {
      const local = { id: '1', updatedAt: '2024-01-02T00:00:00Z', data: 'local' };
      const remote = { id: '1', updatedAt: '2024-01-01T00:00:00Z', data: 'remote' };

      const result = syncService.resolveConflict(local, remote);

      expect(result.data).toBe('local');
    });
  });
});
```

### E2E Test Examples

```typescript
// e2e/sync.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Offline Sync', () => {
  test('should queue changes when offline', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Go offline
    await context.setOffline(true);

    // Make a change
    await page.click('[data-testid="edit-button"]');
    await page.fill('[data-testid="name-input"]', 'Updated Name');
    await page.click('[data-testid="save-button"]');

    // Verify change is queued
    const syncBadge = page.locator('[data-testid="sync-status"]');
    await expect(syncBadge).toContainText('1 pending');

    // Go back online
    await context.setOffline(false);

    // Wait for sync
    await expect(syncBadge).toContainText('Synced', { timeout: 10000 });
  });

  test('should show conflict resolution UI', async ({ page }) => {
    // Simulate conflict scenario
    await page.goto('/');

    // Create a conflict by modifying same record
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('sync:conflict', {
          detail: {
            entityId: '123',
            local: { name: 'Local Version' },
            remote: { name: 'Remote Version' },
          },
        })
      );
    });

    // Verify conflict dialog appears
    const dialog = page.locator('[data-testid="conflict-dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Local Version');
    await expect(dialog).toContainText('Remote Version');
  });
});
```

---

## Deployment Configuration

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - '8090:8090'
    volumes:
      - pb_data:/pb_data
    environment:
      - PB_ENCRYPTION_KEY=${PB_ENCRYPTION_KEY}
    restart: unless-stopped

  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - '3000:80'
    depends_on:
      - backend
    environment:
      - VITE_API_URL=http://backend:8090
    restart: unless-stopped

volumes:
  pb_data:
```

### GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build

  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: cd backend && go test ./...
      - run: cd backend && go build -o server ./cmd/server

  build-electron:
    needs: [test-frontend, test-backend]
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run build:electron
      - uses: actions/upload-artifact@v4
        with:
          name: electron-${{ matrix.os }}
          path: dist/electron/*

  deploy:
    needs: [test-frontend, test-backend]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: |
          # Deploy commands here
          echo "Deploying to production..."
```

---

## Security Considerations

### Authentication Flow

```
┌─────────┐       ┌─────────┐       ┌─────────┐
│  Client │       │   API   │       │   DB    │
└────┬────┘       └────┬────┘       └────┬────┘
     │                 │                 │
     │  POST /login    │                 │
     │────────────────>│                 │
     │                 │  Verify creds   │
     │                 │────────────────>│
     │                 │<────────────────│
     │                 │                 │
     │  JWT + Refresh  │                 │
     │<────────────────│                 │
     │                 │                 │
     │  Request + JWT  │                 │
     │────────────────>│                 │
     │                 │  Validate JWT   │
     │                 │  Check tenant   │
     │                 │────────────────>│
     │                 │<────────────────│
     │  Response       │                 │
     │<────────────────│                 │
```

### Data Encryption

- **At Rest**: SQLite encryption via SQLCipher (Electron)
- **In Transit**: TLS 1.3 for all API communications
- **Sensitive Fields**: Application-level encryption for PII

### Tenant Isolation Checklist

- [ ] All queries include tenant_id filter
- [ ] API endpoints validate tenant access
- [ ] File uploads scoped to tenant directories
- [ ] Audit logs include tenant context
- [ ] Rate limiting per tenant

---

## UI Component Library

### Design System Tokens

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        success: {
          50: '#f0fdf4',
          500: '#22c55e',
          600: '#16a34a',
        },
        warning: {
          50: '#fffbeb',
          500: '#f59e0b',
          600: '#d97706',
        },
        danger: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.75rem' }],
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
} satisfies Config;
```

### Base Components

```typescript
// components/ui/Button.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary-600 text-white hover:bg-primary-700',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        outline: 'border border-gray-300 bg-transparent hover:bg-gray-100',
        ghost: 'hover:bg-gray-100',
        destructive: 'bg-danger-600 text-white hover:bg-danger-700',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, isLoading, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
```

### Form Components

```typescript
// components/ui/Input.tsx
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    const inputId = id || props.name;

    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <input
          id={inputId}
          className={cn(
            'block w-full rounded-md border-gray-300 shadow-sm',
            'focus:border-primary-500 focus:ring-primary-500',
            'disabled:bg-gray-50 disabled:text-gray-500',
            error && 'border-danger-500 focus:border-danger-500 focus:ring-danger-500',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        {hint && !error && <p className="text-sm text-gray-500">{hint}</p>}
      </div>
    );
  }
);

// components/ui/Select.tsx
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, id, ...props }, ref) => {
    const selectId = id || props.name;

    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <select
          id={selectId}
          className={cn(
            'block w-full rounded-md border-gray-300 shadow-sm',
            'focus:border-primary-500 focus:ring-primary-500',
            error && 'border-danger-500',
            className
          )}
          ref={ref}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    );
  }
);
```

### Data Table Component

```typescript
// components/tables/DataTable.tsx
import {
  flexRender,
  type Table as TanstackTable,
} from '@tanstack/react-table';
import { cn } from '@/lib/utils';

interface DataTableProps<T> {
  table: TanstackTable<T>;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  table,
  isLoading,
  emptyMessage = 'No data available',
  onRowClick,
}: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500',
                      header.column.getCanSort() && 'cursor-pointer select-none'
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                    style={{ width: header.getSize() }}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && <ChevronUp className="h-4 w-4" />}
                      {header.column.getIsSorted() === 'desc' && <ChevronDown className="h-4 w-4" />}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {isLoading ? (
              <tr>
                <td colSpan={table.getAllColumns().length} className="px-4 py-8 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getAllColumns().length} className="px-4 py-8 text-center text-gray-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'hover:bg-gray-50',
                    onRowClick && 'cursor-pointer',
                    row.getIsSelected() && 'bg-primary-50'
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3">
        <div className="text-sm text-gray-700">
          Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            table.getFilteredRowModel().rows.length
          )}{' '}
          of {table.getFilteredRowModel().rows.length} results
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### Table Toolbar

```typescript
// components/tables/TableToolbar.tsx
interface TableToolbarProps<T> {
  table: TanstackTable<T>;
  onExport?: (format: 'csv' | 'excel' | 'pdf') => void;
  onPrint?: () => void;
  searchPlaceholder?: string;
}

export function TableToolbar<T>({
  table,
  onExport,
  onPrint,
  searchPlaceholder = 'Search...',
}: TableToolbarProps<T>) {
  const [globalFilter, setGlobalFilter] = useState('');

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder={searchPlaceholder}
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            table.setGlobalFilter(e.target.value);
          }}
          className="w-64"
        />

        {/* Column visibility dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {table.getAllColumns().filter(col => col.getCanHide()).map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        {onExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onExport('csv')}>
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('excel')}>
                Export as Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport('pdf')}>
                Export as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onPrint && (
          <Button variant="outline" size="sm" onClick={onPrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        )}
      </div>
    </div>
  );
}
```

---

## Export Utilities

### CSV Export

```typescript
// utils/export/csv.ts
export function exportToCsv<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; header: string }[],
  filename: string
): void {
  const headers = columns.map(col => col.header);
  const rows = data.map(row =>
    columns.map(col => {
      const value = row[col.key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && value.includes(',')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    })
  );

  const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  downloadFile(csv, `${filename}.csv`, 'text/csv');
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

### Excel Export

```typescript
// utils/export/excel.ts
import * as XLSX from 'xlsx';

export function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; header: string }[],
  filename: string,
  sheetName = 'Sheet1'
): void {
  const headers = columns.map(col => col.header);
  const rows = data.map(row => columns.map(col => row[col.key]));

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Auto-size columns
  const colWidths = columns.map((col, i) => ({
    wch: Math.max(col.header.length, ...rows.map(row => String(row[i] ?? '').length)),
  }));
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
```

### PDF Export

```typescript
// utils/export/pdf.ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function exportToPdf<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; header: string }[],
  filename: string,
  title?: string
): void {
  const doc = new jsPDF();

  if (title) {
    doc.setFontSize(16);
    doc.text(title, 14, 22);
  }

  autoTable(doc, {
    startY: title ? 30 : 14,
    head: [columns.map(col => col.header)],
    body: data.map(row => columns.map(col => String(row[col.key] ?? ''))),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  doc.save(`${filename}.pdf`);
}
```

---

## Routing & Navigation

### Route Configuration

```typescript
// routes/index.tsx
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'resources', element: <ResourceListPage /> },
      { path: 'resources/:id', element: <ResourceDetailPage /> },
      { path: 'resources/new', element: <ResourceCreatePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/tenant', element: <TenantSettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
```

### App Layout

```typescript
// components/layout/AppLayout.tsx
export function AppLayout() {
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const { currentTenant } = useTenant();

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-lg transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between px-4 border-b">
          <Logo />
          <button onClick={toggleSidebar} className="lg:hidden">
            <X className="h-6 w-6" />
          </button>
        </div>

        <nav className="p-4 space-y-1">
          <NavLink to="/" icon={<Home />}>Dashboard</NavLink>
          <NavLink to="/resources" icon={<Database />}>Resources</NavLink>
          <NavLink to="/settings" icon={<Settings />}>Settings</NavLink>
        </nav>

        {/* Tenant selector */}
        <div className="absolute bottom-0 left-0 right-0 border-t p-4">
          <TenantSelector />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b bg-white px-4 shadow-sm">
          <button onClick={toggleSidebar} className="lg:hidden">
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex items-center gap-4">
            <SyncStatus />
            <UserMenu />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

---

## Error Handling & Logging

### Error Boundary

```typescript
// components/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // Send to error tracking service
    logError(error, { componentStack: errorInfo.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
            <p className="mt-2 text-gray-600">{this.state.error?.message}</p>
            <Button
              className="mt-4"
              onClick={() => window.location.reload()}
            >
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

### Logger Service

```typescript
// services/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  private log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (process.env.NODE_ENV === 'development') {
      console[level](message, context);
    }

    // In production, send errors to monitoring service
    if (level === 'error' && process.env.NODE_ENV === 'production') {
      this.sendToMonitoring(entry);
    }
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.log('error', message, context);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  private async sendToMonitoring(entry: LogEntry) {
    // Integration with Sentry, LogRocket, etc.
  }
}

export const logger = new Logger();
```

---

## Performance Optimization

### Virtual Scrolling for Large Tables

```typescript
// components/tables/VirtualDataTable.tsx
import { useVirtualizer } from '@tanstack/react-virtual';

export function VirtualDataTable<T>({ table }: { table: TanstackTable<T> }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // row height
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <table className="min-w-full">
        <thead className="sticky top-0 bg-gray-50 z-10">
          {/* Header rows */}
        </thead>
        <tbody>
          <tr style={{ height: `${virtualizer.getTotalSize()}px` }}>
            <td colSpan={table.getAllColumns().length} className="relative">
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    className="absolute w-full"
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
```

### Code Splitting

```typescript
// routes/lazy.tsx
import { lazy, Suspense } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// Lazy load heavy components
const ResourceListPage = lazy(() => import('@/pages/ResourceListPage'));
const ReportsPage = lazy(() => import('@/pages/ReportsPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

// Wrapper for lazy components
export function LazyPage({ component: Component }: { component: React.LazyExoticComponent<() => JSX.Element> }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Component />
    </Suspense>
  );
}
```

---

## Monitoring & Analytics

### Application Metrics

```typescript
// services/metrics.ts
interface Metric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

class MetricsService {
  private metrics: Metric[] = [];
  private flushInterval = 60000; // 1 minute

  constructor() {
    setInterval(() => this.flush(), this.flushInterval);
  }

  track(name: string, value: number, tags?: Record<string, string>) {
    this.metrics.push({
      name,
      value,
      tags,
      timestamp: Date.now(),
    });
  }

  // Timing helper
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.track(name, performance.now() - start, { unit: 'ms' });
    }
  }

  private async flush() {
    if (this.metrics.length === 0) return;

    const toSend = [...this.metrics];
    this.metrics = [];

    // Send to analytics backend
    try {
      await fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSend),
      });
    } catch (error) {
      // Re-add metrics on failure
      this.metrics.unshift(...toSend);
    }
  }
}

export const metrics = new MetricsService();

// Usage
metrics.track('sync.push.count', pendingChanges.length);
const result = await metrics.time('sync.push.duration', () => api.sync.push(changes));
```

---

## Migration Checklist

### Pre-Migration

- [ ] Complete feature inventory of WinForms application
- [ ] Document all business rules and validation logic
- [ ] Map data structures and relationships
- [ ] Identify integration points (APIs, databases, files)
- [ ] Plan user training and documentation

### Phase 1 Completion Criteria

- [ ] Authentication working with PocketBase
- [ ] Multi-tenant context switching
- [ ] Basic CRUD operations functional
- [ ] SQLite database initialized in Electron
- [ ] Offline detection working

### Phase 2 Completion Criteria

- [ ] TanStack Table renders all column types
- [ ] Sorting, filtering, pagination working
- [ ] Row selection and bulk actions
- [ ] Export to CSV/Excel/PDF
- [ ] Column visibility and reordering

### Phase 3 Completion Criteria

- [ ] All forms migrated with validation
- [ ] Navigation matches original structure
- [ ] Reports generating correctly
- [ ] Business logic verified against original

### Phase 4 Completion Criteria

- [ ] Offline CRUD operations queued
- [ ] Sync push/pull working
- [ ] Conflict resolution UI functional
- [ ] Background sync in Electron

### Phase 5 Completion Criteria

- [ ] Unit test coverage > 80%
- [ ] E2E tests for critical paths
- [ ] Performance benchmarks met
- [ ] Security audit completed

### Phase 6 Completion Criteria

- [ ] CI/CD pipelines operational
- [ ] Staging environment validated
- [ ] Data migration scripts tested
- [ ] Rollback procedures documented
- [ ] User documentation complete

---

## Appendix

### Package Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "@tanstack/react-table": "^8.15.0",
    "@tanstack/react-query": "^5.24.0",
    "@tanstack/react-virtual": "^3.1.0",
    "zustand": "^4.5.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "lucide-react": "^0.344.0",
    "xlsx": "^0.18.5",
    "jspdf": "^2.5.1",
    "jspdf-autotable": "^3.8.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.1.0",
    "tailwindcss": "^3.4.0",
    "@tailwindcss/forms": "^0.5.0",
    "vitest": "^1.3.0",
    "@playwright/test": "^1.42.0",
    "electron": "^29.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

### Useful Commands

```bash
# Development
npm run dev              # Start Vite dev server
npm run dev:electron     # Start Electron in dev mode
npm run test             # Run unit tests
npm run test:e2e         # Run E2E tests

# Build
npm run build            # Build web app
npm run build:electron   # Build Electron app
npm run build:all        # Build all targets

# Backend
cd backend && go run ./cmd/server  # Run PocketBase
cd backend && go test ./...         # Run backend tests
```
