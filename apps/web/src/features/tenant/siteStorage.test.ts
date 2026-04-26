import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/auth/authStorage', () => ({
  getStoredAuthTenantId: vi.fn(),
}));

import { getStoredAuthTenantId } from '@/features/auth/authStorage';
import {
  clearStoredSiteId,
  getStoredSiteId,
  persistSiteId,
} from './siteStorage';

const mockedGetTenant = vi.mocked(getStoredAuthTenantId);

beforeEach(() => {
  mockedGetTenant.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('getStoredSiteId', () => {
  it('reads the localStorage entry under the explicit tenant key', () => {
    window.localStorage.setItem('active_site_id:tenant-1', 'site-A');
    expect(getStoredSiteId('tenant-1')).toBe('site-A');
  });

  it('falls back to getStoredAuthTenantId when tenantId is omitted', () => {
    mockedGetTenant.mockReturnValue('tenant-2');
    window.localStorage.setItem('active_site_id:tenant-2', 'site-B');
    expect(getStoredSiteId()).toBe('site-B');
  });

  it('returns null when both the explicit and resolved tenants are missing', () => {
    mockedGetTenant.mockReturnValue(null);
    expect(getStoredSiteId()).toBeNull();
    expect(getStoredSiteId(null)).toBeNull();
    expect(getStoredSiteId(undefined)).toBeNull();
  });

  it('returns null when the localStorage entry is unset for the tenant', () => {
    expect(getStoredSiteId('tenant-with-no-entry')).toBeNull();
  });
});

describe('persistSiteId', () => {
  it('writes the localStorage entry under the explicit tenant key', () => {
    persistSiteId('site-X', 'tenant-1');
    expect(window.localStorage.getItem('active_site_id:tenant-1')).toBe('site-X');
  });

  it('falls back to getStoredAuthTenantId when tenantId is omitted', () => {
    mockedGetTenant.mockReturnValue('tenant-3');
    persistSiteId('site-Y');
    expect(window.localStorage.getItem('active_site_id:tenant-3')).toBe('site-Y');
  });

  it('is a no-op when neither the explicit nor resolved tenant is available', () => {
    mockedGetTenant.mockReturnValue(null);
    persistSiteId('site-anywhere');
    persistSiteId('site-anywhere', null);
    persistSiteId('site-anywhere', undefined);
    // No keys written.
    expect(window.localStorage.length).toBe(0);
  });

  it('overwrites an existing entry for the same tenant', () => {
    persistSiteId('site-1', 'tenant-1');
    persistSiteId('site-2', 'tenant-1');
    expect(window.localStorage.getItem('active_site_id:tenant-1')).toBe('site-2');
  });
});

describe('clearStoredSiteId', () => {
  it('removes the localStorage entry under the explicit tenant key', () => {
    window.localStorage.setItem('active_site_id:tenant-1', 'site-A');
    clearStoredSiteId('tenant-1');
    expect(window.localStorage.getItem('active_site_id:tenant-1')).toBeNull();
  });

  it('falls back to getStoredAuthTenantId when tenantId is omitted', () => {
    mockedGetTenant.mockReturnValue('tenant-4');
    window.localStorage.setItem('active_site_id:tenant-4', 'site-B');
    clearStoredSiteId();
    expect(window.localStorage.getItem('active_site_id:tenant-4')).toBeNull();
  });

  it('is a no-op when neither the explicit nor resolved tenant is available', () => {
    mockedGetTenant.mockReturnValue(null);
    window.localStorage.setItem('active_site_id:other', 'site-C');
    clearStoredSiteId();
    clearStoredSiteId(null);
    clearStoredSiteId(undefined);
    // The unrelated entry is preserved.
    expect(window.localStorage.getItem('active_site_id:other')).toBe('site-C');
  });
});
