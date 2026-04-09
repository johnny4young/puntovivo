import { Plus } from 'lucide-react';
import { ResourcePage } from '@/components/resources/ResourcePage';
import {
  buildCityColumns,
  buildCountryColumns,
  buildDepartmentColumns,
} from '@/features/geography/geographyColumns';
import type { City, Country, Department } from '@/types';

interface GeographyTabsProps {
  activeTab: 'countries' | 'departments' | 'cities';
  onChange: (tab: 'countries' | 'departments' | 'cities') => void;
}

export function GeographyTabs({ activeTab, onChange }: GeographyTabsProps) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-secondary-200 bg-white p-2">
      <button
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'countries'
            ? 'bg-primary-600 text-white'
            : 'text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900'
        }`}
        onClick={() => onChange('countries')}
      >
        Countries
      </button>
      <button
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'departments'
            ? 'bg-primary-600 text-white'
            : 'text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900'
        }`}
        onClick={() => onChange('departments')}
      >
        Departments
      </button>
      <button
        className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
          activeTab === 'cities'
            ? 'bg-primary-600 text-white'
            : 'text-secondary-600 hover:bg-secondary-100 hover:text-secondary-900'
        }`}
        onClick={() => onChange('cities')}
      >
        Cities
      </button>
    </div>
  );
}

interface CountryCatalogSectionProps {
  canManage: boolean;
  countries: Country[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (country: Country) => void;
  onDelete: (country: Country) => void;
  onRetry: () => void;
}

export function CountryCatalogSection({
  canManage,
  countries,
  isLoading,
  error,
  onCreate,
  onEdit,
  onDelete,
  onRetry,
}: CountryCatalogSectionProps) {
  return (
    <ResourcePage
      title="Geography"
      description="Manage the normalized country catalog used by department, city, and supplier records."
      action={
        <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
          <Plus className="h-5 w-5" />
          Add Country
        </button>
      }
      columns={buildCountryColumns(onEdit, onDelete, canManage, canManage)}
      data={countries}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder="Search countries..."
      loadingMessage="Loading countries..."
      onRetry={onRetry}
    />
  );
}

interface DepartmentCatalogSectionProps {
  canManage: boolean;
  departments: Department[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (department: Department) => void;
  onDelete: (department: Department) => void;
  onRetry: () => void;
}

export function DepartmentCatalogSection({
  canManage,
  departments,
  isLoading,
  error,
  onCreate,
  onEdit,
  onDelete,
  onRetry,
}: DepartmentCatalogSectionProps) {
  return (
    <ResourcePage
      title="Geography"
      description="Manage the normalized department catalog used by city and supplier records."
      action={
        <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
          <Plus className="h-5 w-5" />
          Add Department
        </button>
      }
      columns={buildDepartmentColumns(onEdit, onDelete, canManage, canManage)}
      data={departments}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder="Search departments..."
      loadingMessage="Loading departments..."
      onRetry={onRetry}
    />
  );
}

interface CityCatalogSectionProps {
  canManage: boolean;
  cities: City[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (city: City) => void;
  onDelete: (city: City) => void;
  onRetry: () => void;
}

export function CityCatalogSection({
  canManage,
  cities,
  isLoading,
  error,
  onCreate,
  onEdit,
  onDelete,
  onRetry,
}: CityCatalogSectionProps) {
  return (
    <ResourcePage
      title="Geography"
      description="Manage the normalized city catalog used by supplier records."
      action={
        <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
          <Plus className="h-5 w-5" />
          Add City
        </button>
      }
      columns={buildCityColumns(onEdit, onDelete, canManage, canManage)}
      data={cities}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder="Search cities..."
      loadingMessage="Loading cities..."
      onRetry={onRetry}
    />
  );
}
