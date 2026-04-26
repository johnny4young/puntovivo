import { describe, it, expect } from 'vitest';
import {
  adminOnlyRoles,
  managerOrAdminRoles,
  salesRoles,
  dashboardRoles,
  canAccessRole,
  getDefaultRouteForRole,
} from './roleAccess';

describe('roleAccess role tuples', () => {
  it('exposes the documented role groupings as tuples', () => {
    expect([...adminOnlyRoles]).toEqual(['admin']);
    expect([...managerOrAdminRoles]).toEqual(['admin', 'manager']);
    expect([...salesRoles]).toEqual(['admin', 'manager', 'cashier']);
    expect([...dashboardRoles]).toEqual(['admin', 'manager', 'viewer']);
  });
});

describe('canAccessRole', () => {
  it('treats undefined allowedRoles as fully open', () => {
    expect(canAccessRole('admin')).toBe(true);
    expect(canAccessRole('cashier')).toBe(true);
    expect(canAccessRole(undefined)).toBe(true);
  });

  it('treats an empty allowedRoles tuple as fully open', () => {
    expect(canAccessRole('viewer', [])).toBe(true);
    expect(canAccessRole(undefined, [])).toBe(true);
  });

  it('rejects undefined roles when an allowlist is supplied', () => {
    expect(canAccessRole(undefined, adminOnlyRoles)).toBe(false);
    expect(canAccessRole(undefined, salesRoles)).toBe(false);
  });

  it('admits exactly the listed roles', () => {
    expect(canAccessRole('admin', adminOnlyRoles)).toBe(true);
    expect(canAccessRole('manager', adminOnlyRoles)).toBe(false);
    expect(canAccessRole('cashier', adminOnlyRoles)).toBe(false);
    expect(canAccessRole('viewer', adminOnlyRoles)).toBe(false);

    expect(canAccessRole('admin', managerOrAdminRoles)).toBe(true);
    expect(canAccessRole('manager', managerOrAdminRoles)).toBe(true);
    expect(canAccessRole('cashier', managerOrAdminRoles)).toBe(false);

    expect(canAccessRole('admin', salesRoles)).toBe(true);
    expect(canAccessRole('cashier', salesRoles)).toBe(true);
    expect(canAccessRole('viewer', salesRoles)).toBe(false);

    expect(canAccessRole('viewer', dashboardRoles)).toBe(true);
    expect(canAccessRole('cashier', dashboardRoles)).toBe(false);
  });
});

describe('getDefaultRouteForRole', () => {
  it('routes cashiers to /sales (their primary surface)', () => {
    expect(getDefaultRouteForRole('cashier')).toBe('/sales');
  });

  it('routes every other role (and undefined) to /dashboard', () => {
    expect(getDefaultRouteForRole('admin')).toBe('/dashboard');
    expect(getDefaultRouteForRole('manager')).toBe('/dashboard');
    expect(getDefaultRouteForRole('viewer')).toBe('/dashboard');
    expect(getDefaultRouteForRole(undefined)).toBe('/dashboard');
  });
});
