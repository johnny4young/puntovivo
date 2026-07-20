// catalog / geography domain shapes ( slice 28).

import type { UnitDimension } from '@puntovivo/shared/units';

export interface Provider {
  id: string;
  tenantId: string;
  name: string;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  cityId?: string | null;
  cityName?: string | null;
  departmentName?: string | null;
  countryName?: string | null;
  contactName?: string | null;
  isActive: boolean;
  assignedCategoryCount?: number;
  // optimistic-concurrency token (round-tripped on update).
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCategoryAssignment {
  id: string;
  categoryId: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Department {
  id: string;
  tenantId: string;
  countryId?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface City {
  id: string;
  tenantId: string;
  departmentId: string;
  countryId?: string | null;
  countryName?: string | null;
  departmentCode?: string | null;
  departmentName?: string | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Country {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VatRate {
  id: string;
  tenantId: string;
  name: string;
  rate: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Physical dimension of a unit (Auditoría 2026-07 — units foundation). */
export type { UnitDimension } from '@puntovivo/shared/units';

export interface Unit {
  id: string;
  tenantId: string;
  name: string;
  abbreviation: string;
  /** Physical dimension; null on legacy/unknown units. */
  dimension?: UnitDimension | null;
  /** UN/ECE Rec 20 unit code for fiscal e-invoicing; null when unmapped. */
  standardCode?: string | null;
  /** Multiplier into the dimension's reference unit; null when unmapped. */
  referenceFactor?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
