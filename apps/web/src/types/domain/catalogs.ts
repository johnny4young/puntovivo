// ENG-179c — catalog / geography domain shapes (ENG-178 slice 28).

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
  // ENG-177a — optimistic-concurrency token (round-tripped on update).
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

export interface Unit {
  id: string;
  tenantId: string;
  name: string;
  abbreviation: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
