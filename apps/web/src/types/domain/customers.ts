// customer domain shapes ( slice 28).

import type { SyncStatus } from '../ui';

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  taxId?: string | null;
  identificationTypeId?: string | null;
  personTypeId?: string | null;
  regimeTypeId?: string | null;
  clientTypeId?: string | null;
  commercialActivityId?: string | null;
  notes?: string | null;
  // per-customer cupo de crédito. `0 = sin cupo` (no
  // limit); the server NOT-NULL default + Zod nonnegative refinement
  // make this always present.
  creditLimit?: number;
  isActive: boolean;
  privacyStatus?: 'active' | 'anonymized';
  privacyDisposedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus | null;
  syncVersion?: number;
  // optimistic-concurrency token (round-tripped on update).
  version: number;
}

export interface CustomerCatalogItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
