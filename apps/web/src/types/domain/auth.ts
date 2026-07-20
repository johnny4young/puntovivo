// auth / identity domain shapes (split from the former
// monolithic `types/domain.ts`,  slice 28). String-literal unions
// live in `../ui`.

import type { UserRole } from '../ui';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: UserRole;
  tenantId: string;
  isActive?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: TenantSettings;
  createdAt: string;
  updatedAt: string;
}

export interface TenantSettings {
  /*
   * `currency`, `timezone` and `dateFormat` used to live here and
   * were declared REQUIRED, but  moved locale resolution to the
   * `tenant_locale_settings` table (country defaults + explicit overrides;
   * see `services/tenant-locale.ts` and the note atop `lib/currency.ts`).
   * Nothing wrote them any more and nothing read them, so the type was
   * promising three fields the payload no longer carries — the worst kind of
   * dead code, because it type-checks.
   */
  taxRate: number;
  logo?: string;
  theme?: 'light' | 'dark' | 'system';
  /**
   * Restaurant-specific tenant settings. Currently a single
   * field (`serviceChargeRate`). Defaults to `{ serviceChargeRate: 0 }`
   * so retail tenants pay zero surface cost.
   */
  restaurant?: {
    serviceChargeRate: number;
  };
  /**
   * Cash-close flow settings. `blindClose` defaults to true
   * (anti-fraud: cashiers count without seeing the expected balance and
   * only managers/admins get the live over/short semaphore); false is an
   * explicit tenant opt-out that shows the semaphore to every role.
   */
  cashClose?: {
    blindClose: boolean;
  };
  /**
   * tenant-tuned expiry-discount ladder (first match wins,
   * always sorted ascending by `maxDays` server-side). Absent for tenants
   * that never tuned it; the radar falls back to the  defaults.
   */
  discount?: {
    expiryTiers: Array<{ maxDays: number; pct: number }>;
  };
}

export interface Site {
  id: string;
  tenantId: string;
  companyId: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
  assignedLocationCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoId?: string | null;
  logoUrl?: string | null;
  logoName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Logo {
  id: string;
  tenantId: string;
  name: string;
  imageUrl: string;
  isActive: boolean;
  assignedCompanyCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Sequential {
  id: string;
  tenantId: string;
  siteId: string;
  documentType: 'sale' | 'purchase' | 'order' | 'quotation';
  prefix: string;
  currentValue: number;
  createdAt: string;
  updatedAt: string;
  siteName?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  tenant: Tenant;
}
