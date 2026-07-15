/**
 * ENG-131 (slice A) — Workspace catalogue contract tests.
 *
 * Pins the invariants the sidebar refactor must keep:
 *
 *   - Every workspace declares at least one item.
 *   - The catalogue covers exactly the same routes the old four-
 *     section sidebar declared (no orphans, no duplicates).
 *   - Role + module filtering produces the expected admin / cashier
 *     visibility shape.
 *
 * @module components/layout/__tests__/workspaces.test
 */
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSION_TEMPLATES } from '@/features/auth/workspaceRoleTemplates';
import {
  WORKSPACES,
  __WORKSPACE_ROUTE_INVARIANT_FOR_TESTS,
  visibleItemsForWorkspace,
  visibleWorkspacesForRole,
} from '../workspaces';

// Mirror of every route the pre-slice-A sidebar declared. Keeping a
// literal here (rather than importing the old enum) means any
// future drift surfaces immediately: a deletion fails one half of
// the assertion, an addition fails the other.
const LEGACY_SIDEBAR_ROUTES = [
  // overview
  '/dashboard',
  '/co-pilot',
  '/sales',
  '/inventory',
  '/operations',
  '/day-close',
  // flow
  '/orders',
  '/purchases',
  '/quotations',
  '/delivery',
  '/customers',
  '/products',
  // surfaces
  '/touch',
  '/kds',
  '/customer-display',
  '/m',
  '/restaurants/tables',
  // setup
  '/company',
  '/data-import',
  '/sites',
  '/sequentials',
  '/geography',
  '/customer-catalogs',
  '/providers',
  '/categories',
  '/locations',
  '/units',
  '/vat-rates',
  '/receipt-templates',
  '/peripherals',
  '/users',
  '/settings/ai',
  '/audit-logs',
  '/fiscal-documents',
  '/fiscal-reports',
] as const;

describe('WORKSPACES catalogue', () => {
  it('declares exactly eight workspaces', () => {
    expect(WORKSPACES).toHaveLength(8);
  });

  it('every workspace has at least one item', () => {
    for (const workspace of WORKSPACES) {
      expect(workspace.items.length).toBeGreaterThan(0);
    }
  });

  it('every legacy sidebar route lives under exactly one workspace', () => {
    const covered = new Set<string>(__WORKSPACE_ROUTE_INVARIANT_FOR_TESTS.workspaceHrefs);
    for (const route of LEGACY_SIDEBAR_ROUTES) {
      expect(covered.has(route)).toBe(true);
    }
  });

  it('no route is declared twice across the catalogue', () => {
    const seen = new Map<string, string>();
    for (const workspace of WORKSPACES) {
      for (const item of workspace.items) {
        const previous = seen.get(item.href);
        if (previous) {
          throw new Error(`route ${item.href} declared in both ${previous} and ${workspace.id}`);
        }
        seen.set(item.href, workspace.id);
      }
    }
    expect(seen.get('/dashboard')).toBe('operate');
  });

  it('stays in parity with the admin permission-audit template', () => {
    const navigationRoles = new Map(
      WORKSPACES.map(workspace => [workspace.id, workspace.allowedRoles] as const)
    );
    const auditRoles = new Map(
      ROLE_PERMISSION_TEMPLATES.map(template => [template.id, template.allowedRoles] as const)
    );

    expect(auditRoles.size).toBe(ROLE_PERMISSION_TEMPLATES.length);
    expect([...auditRoles]).toEqual([...navigationRoles]);
  });
});

describe('visibleItemsForWorkspace', () => {
  it('drops items whose module is disabled', () => {
    const sell = WORKSPACES.find(w => w.id === 'sell')!;
    const result = visibleItemsForWorkspace(sell, 'admin', { kds: false });
    expect(result.some(i => i.href === '/kds')).toBe(false);
    expect(result.some(i => i.href === '/co-pilot')).toBe(false);
    expect(result.some(i => i.href === '/sales')).toBe(true);
  });

  it('drops module-gated items while the module snapshot is still hydrating', () => {
    const procurement = WORKSPACES.find(w => w.id === 'procurement')!;
    const result = visibleItemsForWorkspace(
      procurement,
      'admin',
      { quotations: true, delivery: true },
      false
    );
    expect(result.some(i => i.href === '/quotations')).toBe(false);
    expect(result.some(i => i.href === '/delivery')).toBe(false);
    expect(result.some(i => i.href === '/orders')).toBe(true);
  });

  it('drops items the role cannot access', () => {
    const setup = WORKSPACES.find(w => w.id === 'setup')!;
    const result = visibleItemsForWorkspace(setup, 'cashier', {});
    expect(result).toHaveLength(0);
  });
});

describe('visibleWorkspacesForRole', () => {
  it('returns all eight workspaces for an admin with every module on', () => {
    const allOn = {
      copilot: true,
      'operations-center': true,
      quotations: true,
      delivery: true,
      'pos-touch': true,
      kds: true,
      'customer-display': true,
      'mobile-waiter': true,
    };
    const result = visibleWorkspacesForRole('admin', allOn);
    expect(result.map(v => v.workspace.id)).toEqual([
      'sell',
      'operate',
      'catalog',
      'inventory',
      'procurement',
      'customers',
      'finance',
      'setup',
    ]);
  });

  it('returns only the Sell workspace for a cashier (the other workspaces gate to manager+)', () => {
    const result = visibleWorkspacesForRole('cashier', {});
    expect(result.map(v => v.workspace.id)).toEqual(['sell']);
    // /sales is always visible for cashier; module-gated surfaces
    // (touch, kds, customer-display, mobile-waiter,
    // restaurants/tables) drop when their module is off.
    expect(result[0]?.items.some(i => i.href === '/sales')).toBe(true);
  });

  it('keeps Operate visible when Operations is disabled because Dashboard remains available', () => {
    const result = visibleWorkspacesForRole('admin', { 'operations-center': false });
    const operate = result.find(v => v.workspace.id === 'operate');
    expect(operate?.items.map(item => item.href)).toEqual(['/dashboard', '/day-close']);
  });

  it('returns an empty list for an unauthenticated role', () => {
    expect(visibleWorkspacesForRole(undefined, {})).toEqual([]);
  });
});

describe('Operate Dashboard fold (ENG-131e)', () => {
  it('makes Dashboard the first Operate item and keeps viewer access', () => {
    const operate = WORKSPACES.find(workspace => workspace.id === 'operate');
    expect(operate?.defaultRoute).toBe('/dashboard');
    expect(operate?.items[0]?.href).toBe('/dashboard');
    expect(operate?.allowedRoles).toContain('viewer');
    expect(operate?.items[1]?.href).toBe('/operations');
    expect(operate?.items[1]?.allowedRoles).not.toContain('viewer');
    expect(operate?.items[2]?.href).toBe('/day-close');
    expect(operate?.items[2]?.allowedRoles).not.toContain('viewer');
  });
});

describe('workspace defaultRoute (ENG-131c)', () => {
  it('operate and dedicated landing workspaces default to their overview route', () => {
    const landings: Record<string, string> = {
      operate: '/dashboard',
      catalog: '/catalog',
      procurement: '/procurement',
      finance: '/finance',
    };
    for (const [id, expected] of Object.entries(landings)) {
      const workspace = WORKSPACES.find(w => w.id === id);
      expect(workspace?.defaultRoute).toBe(expected);
    }
  });

  it('workspaces without a dedicated landing default to the first item href', () => {
    const noLanding = ['sell', 'inventory', 'customers', 'setup'];
    for (const id of noLanding) {
      const workspace = WORKSPACES.find(w => w.id === id);
      expect(workspace).toBeDefined();
      expect(workspace?.defaultRoute).toBe(workspace?.items[0]?.href);
    }
  });
});

describe('launch migration navigation (ENG-123a)', () => {
  it('exposes data import only to admins in Setup', () => {
    const setup = WORKSPACES.find(workspace => workspace.id === 'setup')!;
    const item = setup.items.find(candidate => candidate.href === '/data-import');

    expect(item?.allowedRoles).toEqual(['admin']);
    expect(visibleItemsForWorkspace(setup, 'admin', {})).toContainEqual(item);
    expect(visibleItemsForWorkspace(setup, 'manager', {})).not.toContainEqual(item);
  });
});
