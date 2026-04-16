import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
  return (
    <div className="segmented-control mb-6">
      <button
        className={`segmented-tab ${activeTab === 'countries' ? 'segmented-tab-active' : ''}`}
        onClick={() => onChange('countries')}
      >
        {t('geography.tabs.countries')}
      </button>
      <button
        className={`segmented-tab ${activeTab === 'departments' ? 'segmented-tab-active' : ''}`}
        onClick={() => onChange('departments')}
      >
        {t('geography.tabs.departments')}
      </button>
      <button
        className={`segmented-tab ${activeTab === 'cities' ? 'segmented-tab-active' : ''}`}
        onClick={() => onChange('cities')}
      >
        {t('geography.tabs.cities')}
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
  const { t } = useTranslation('settings');
  return (
    <ResourcePage
      title={t('geography.title')}
      description={t('geography.countries.description')}
      action={
        <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
          <Plus className="h-5 w-5" />
          {t('geography.countries.add')}
        </button>
      }
      columns={buildCountryColumns(onEdit, onDelete, canManage, canManage, t)}
      data={countries}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder={t('geography.countries.search')}
      loadingMessage={t('geography.countries.loading')}
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
  const { t } = useTranslation('settings');
  return (
    <ResourcePage
      title={t('geography.title')}
      description={t('geography.departments.description')}
      action={
        <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
          <Plus className="h-5 w-5" />
          {t('geography.departments.add')}
        </button>
      }
      columns={buildDepartmentColumns(onEdit, onDelete, canManage, canManage, t)}
      data={departments}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder={t('geography.departments.search')}
      loadingMessage={t('geography.departments.loading')}
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
  const { t } = useTranslation('settings');
  return (
    <ResourcePage
      title={t('geography.title')}
      description={t('geography.cities.description')}
      action={
        <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
          <Plus className="h-5 w-5" />
          {t('geography.cities.add')}
        </button>
      }
      columns={buildCityColumns(onEdit, onDelete, canManage, canManage, t)}
      data={cities}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder={t('geography.cities.search')}
      loadingMessage={t('geography.cities.loading')}
      onRetry={onRetry}
    />
  );
}
