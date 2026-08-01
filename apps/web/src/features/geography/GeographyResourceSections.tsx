import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ResourcePage } from '@/components/resources/ResourcePage';
import {
  buildCityColumns,
  buildCountryColumns,
  buildDepartmentColumns,
} from '@/features/geography/geographyColumns';
import type { City, Country, Department } from '@/types';

interface CountryCatalogSectionProps {
  canManage: boolean;
  countries: Country[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (country: Country) => void;
  onDelete: (country: Country) => void;
  onOpenDepartments: (country: Country) => void;
  onRetry: () => void;
}

export function CountryCatalogSection(props: CountryCatalogSectionProps): React.ReactElement {
  const { t } = useTranslation('geography');
  return (
    <ResourcePage
      title={t('countries.title')}
      headingLevel={2}
      description={t('countries.description')}
      action={
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={props.onCreate}
          disabled={!props.canManage}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {t('countries.add')}
        </button>
      }
      columns={buildCountryColumns({
        t,
        canManage: props.canManage,
        onEdit: props.onEdit,
        onDelete: props.onDelete,
        onOpenDepartments: props.onOpenDepartments,
      })}
      data={props.countries}
      isLoading={props.isLoading}
      error={props.error}
      searchKey="name"
      searchPlaceholder={t('countries.search')}
      loadingMessage={t('countries.loading')}
      onRetry={props.onRetry}
      {...(props.canManage ? { onRowActivate: props.onEdit } : {})}
      enableRowSelection={false}
    />
  );
}

interface DepartmentCatalogSectionProps {
  canManage: boolean;
  country: Country;
  departments: Department[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (department: Department) => void;
  onDelete: (department: Department) => void;
  onOpenCities: (department: Department) => void;
  onRetry: () => void;
}

export function DepartmentCatalogSection(
  props: DepartmentCatalogSectionProps
): React.ReactElement {
  const { t } = useTranslation('geography');
  return (
    <ResourcePage
      title={t('departments.title', { country: props.country.name })}
      headingLevel={2}
      description={t('departments.description')}
      action={
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={props.onCreate}
          disabled={!props.canManage}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {t('departments.add')}
        </button>
      }
      columns={buildDepartmentColumns({
        t,
        canManage: props.canManage,
        onEdit: props.onEdit,
        onDelete: props.onDelete,
        onOpenCities: props.onOpenCities,
      })}
      data={props.departments}
      isLoading={props.isLoading}
      error={props.error}
      searchKey="name"
      searchPlaceholder={t('departments.search')}
      loadingMessage={t('departments.loading')}
      onRetry={props.onRetry}
      {...(props.canManage ? { onRowActivate: props.onEdit } : {})}
      enableRowSelection={false}
    />
  );
}

interface CityCatalogSectionProps {
  canManage: boolean;
  department: Department;
  cities: City[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onEdit: (city: City) => void;
  onDelete: (city: City) => void;
  onRetry: () => void;
}

export function CityCatalogSection(props: CityCatalogSectionProps): React.ReactElement {
  const { t } = useTranslation('geography');
  return (
    <ResourcePage
      title={t('cities.title', { department: props.department.name })}
      headingLevel={2}
      description={t('cities.description')}
      action={
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={props.onCreate}
          disabled={!props.canManage}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          {t('cities.add')}
        </button>
      }
      columns={buildCityColumns({
        t,
        canManage: props.canManage,
        onEdit: props.onEdit,
        onDelete: props.onDelete,
      })}
      data={props.cities}
      isLoading={props.isLoading}
      error={props.error}
      searchKey="name"
      searchPlaceholder={t('cities.search')}
      loadingMessage={t('cities.loading')}
      onRetry={props.onRetry}
      {...(props.canManage ? { onRowActivate: props.onEdit } : {})}
      enableRowSelection={false}
    />
  );
}
