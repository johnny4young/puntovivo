import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAuthSession,
  getStoredAuthTenant,
  getStoredAuthTenantId,
  persistAuthSession,
} from './authStorage';

const tenant = {
  id: 'tenant-1',
  name: 'Demo',
  slug: 'demo',
  settings: {
    currency: 'USD',
    timezone: 'UTC',
    dateFormat: 'YYYY-MM-DD',
    taxRate: 0,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const;

const user = {
  id: 'u-1',
  email: 'admin@localhost',
  name: 'Admin',
  role: 'admin' as const,
  tenantId: 'tenant-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('persistAuthSession', () => {
  it('writes user + tenant to localStorage when both are present', () => {
    persistAuthSession({ user, tenant });
    expect(JSON.parse(window.localStorage.getItem('auth_user')!)).toEqual(user);
    expect(JSON.parse(window.localStorage.getItem('auth_tenant')!)).toEqual(tenant);
  });

  it('removes the tenant key when snapshot.tenant is null (no stale state)', () => {
    window.localStorage.setItem('auth_tenant', JSON.stringify(tenant));
    persistAuthSession({ user, tenant: null });
    expect(window.localStorage.getItem('auth_user')).not.toBeNull();
    expect(window.localStorage.getItem('auth_tenant')).toBeNull();
  });
});

describe('getStoredAuthTenant', () => {
  it('returns null when no tenant entry is stored', () => {
    expect(getStoredAuthTenant()).toBeNull();
  });

  it('parses a valid JSON tenant payload', () => {
    window.localStorage.setItem('auth_tenant', JSON.stringify(tenant));
    expect(getStoredAuthTenant()).toEqual(tenant);
  });

  it('returns null when the stored payload is corrupt JSON (catches the parse error)', () => {
    window.localStorage.setItem('auth_tenant', '{not-json');
    expect(getStoredAuthTenant()).toBeNull();
  });
});

describe('getStoredAuthTenantId', () => {
  it('returns the tenant id when a tenant is stored', () => {
    window.localStorage.setItem('auth_tenant', JSON.stringify(tenant));
    expect(getStoredAuthTenantId()).toBe('tenant-1');
  });

  it('returns null when no tenant is stored', () => {
    expect(getStoredAuthTenantId()).toBeNull();
  });

  it('returns null when the stored tenant has no id (defensive against partial writes)', () => {
    window.localStorage.setItem('auth_tenant', JSON.stringify({ name: 'X' }));
    expect(getStoredAuthTenantId()).toBeNull();
  });
});

describe('clearAuthSession', () => {
  it('removes both the user and tenant entries', () => {
    window.localStorage.setItem('auth_user', JSON.stringify(user));
    window.localStorage.setItem('auth_tenant', JSON.stringify(tenant));
    clearAuthSession();
    expect(window.localStorage.getItem('auth_user')).toBeNull();
    expect(window.localStorage.getItem('auth_tenant')).toBeNull();
  });

  it('is a no-op when nothing is stored (does not throw)', () => {
    expect(() => clearAuthSession()).not.toThrow();
  });
});
