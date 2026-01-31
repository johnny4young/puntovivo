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
