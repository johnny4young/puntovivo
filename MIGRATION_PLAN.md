# Migration Plan: .NET WinForms to Modern Web Application

## Overview

This document outlines the migration strategy from a .NET WinForms desktop application to a modern web application with Electron support for desktop deployment.

## Target Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | ReactJS |
| Styling | Tailwind CSS |
| Data Tables | TanStack Table |
| Backend | Golang |
| Backend Framework | PocketBase |
| Database | SQLite |
| Desktop | Electron |

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

| WinForms Feature | TanStack Implementation |
|-----------------|------------------------|
| Column sorting | `getSortedRowModel()` |
| Column filtering | `getFilteredRowModel()` + custom filter UI |
| Row selection | `enableRowSelection` + `onRowSelectionChange` |
| Multi-select | `enableMultiRowSelection` |
| Column reorder | `@tanstack/react-table` column order state |
| Column resize | `enableColumnResizing` + `columnResizeMode` |
| Virtual scroll | `@tanstack/react-virtual` integration |
| Cell editing | Custom cell renderer with edit mode |
| Context menu | Custom right-click handler |
| Export to Excel | `xlsx` library integration |
| Print | Custom print stylesheet + `window.print()` |

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

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Foundation | 3-4 weeks | None |
| Phase 2: Data Tables | 2-3 weeks | Phase 1 |
| Phase 3: Feature Migration | 6-8 weeks | Phase 2 |
| Phase 4: Offline & Sync | 3-4 weeks | Phase 1, 3 |
| Phase 5: Testing | 2-3 weeks | Phase 3, 4 |
| Phase 6: Deployment | 2-3 weeks | Phase 5 |

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
    const url = this.tenantId
      ? `/api/${this.tenantId}${endpoint}`
      : `/api${endpoint}`;

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
    (set) => ({
      sidebarOpen: true,
      theme: 'system',
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
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
    (set) => ({
      pendingChanges: [],
      lastSyncTime: null,
      isSyncing: false,
      syncErrors: [],

      addPendingChange: (change) =>
        set((state) => ({
          pendingChanges: [...state.pendingChanges, change]
        })),
      removePendingChanges: (ids) =>
        set((state) => ({
          pendingChanges: state.pendingChanges.filter(c => !ids.includes(c.id))
        })),
      setSyncing: (syncing) => set({ isSyncing: syncing }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      addSyncError: (error) =>
        set((state) => ({ syncErrors: [...state.syncErrors, error] })),
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
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
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
    return params ? stmt.all(...params) as T[] : stmt.all() as T[];
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
    query: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:query', sql, params),
    execute: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('db:execute', sql, params),
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
        { id: '1', entityType: 'users', operation: 'update', data: { name: 'Test' } }
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
      window.dispatchEvent(new CustomEvent('sync:conflict', {
        detail: {
          entityId: '123',
          local: { name: 'Local Version' },
          remote: { name: 'Remote Version' },
        }
      }));
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
      - "8090:8090"
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
      - "3000:80"
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
