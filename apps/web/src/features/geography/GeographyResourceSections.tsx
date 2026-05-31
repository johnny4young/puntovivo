import { useMemo, useState } from 'react';
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

/**
 * Rediseño FASE 6 — control de filtro encadenado de la jerarquía geográfica.
 * Reutiliza la receta canónica `.pv-field` + `.pv-input` (el mismo seam que
 * los selects de formulario en §07) para que el `<select>` nativo herede
 * altura, foco y tokens del sistema sin chrome legacy. El `<label>` queda
 * asociado por `htmlFor`/`id` para lectores de pantalla.
 */
interface GeographyFilterSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: { id: string; name: string }[];
  disabled?: boolean;
}

function GeographyFilterSelect({
  id,
  label,
  value,
  onChange,
  allLabel,
  options,
  disabled = false,
}: GeographyFilterSelectProps) {
  return (
    <label htmlFor={id} className="pv-field min-w-[180px]">
      <span className="label">{label}</span>
      <select
        id={id}
        className="pv-input"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">{allLabel}</option>
        {options.map(option => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
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
  countries: Country[];
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
  countries,
  departments,
  isLoading,
  error,
  onCreate,
  onEdit,
  onDelete,
  onRetry,
}: DepartmentCatalogSectionProps) {
  const { t } = useTranslation('settings');
  // Rediseño FASE 6 — filtro encadenado: el país elegido acota la lista de
  // departamentos. Estado local de presentación; no toca el contrato tRPC.
  const [countryId, setCountryId] = useState('');

  const visibleDepartments = useMemo(
    () => (countryId ? departments.filter(department => department.countryId === countryId) : departments),
    [departments, countryId]
  );

  return (
    <ResourcePage
      title={t('geography.title')}
      description={t('geography.departments.description')}
      action={
        <div className="flex flex-wrap items-end gap-3">
          <GeographyFilterSelect
            id="geography-department-country-filter"
            label={t('geography.filters.country')}
            value={countryId}
            onChange={setCountryId}
            allLabel={t('geography.filters.allCountries')}
            options={countries}
          />
          <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            {t('geography.departments.add')}
          </button>
        </div>
      }
      columns={buildDepartmentColumns(onEdit, onDelete, canManage, canManage, t)}
      data={visibleDepartments}
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
  countries: Country[];
  departments: Department[];
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
  countries,
  departments,
  cities,
  isLoading,
  error,
  onCreate,
  onEdit,
  onDelete,
  onRetry,
}: CityCatalogSectionProps) {
  const { t } = useTranslation('settings');
  // Rediseño FASE 6 — filtro encadenado País → Departamento → Ciudad. Elegir
  // un país acota la lista de departamentos y de ciudades; elegir un
  // departamento acota las ciudades. Estado local de presentación.
  const [countryId, setCountryId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  // El select de departamento solo ofrece los del país elegido. Si no hay
  // país, ofrece todos. Cambiar el país limpia el departamento que ya no
  // pertenezca a la nueva selección (se resuelve en el handler de abajo).
  const departmentOptions = useMemo(
    () => (countryId ? departments.filter(department => department.countryId === countryId) : departments),
    [departments, countryId]
  );

  const visibleCities = useMemo(() => {
    return cities.filter(city => {
      if (departmentId) return city.departmentId === departmentId;
      if (countryId) return city.countryId === countryId;
      return true;
    });
  }, [cities, countryId, departmentId]);

  function handleCountryChange(nextCountryId: string) {
    setCountryId(nextCountryId);
    // Limpia el departamento si ya no pertenece al país recién elegido.
    if (departmentId) {
      const stillValid = departments.some(
        department => department.id === departmentId && department.countryId === nextCountryId
      );
      if (!nextCountryId || !stillValid) {
        setDepartmentId('');
      }
    }
  }

  return (
    <ResourcePage
      title={t('geography.title')}
      description={t('geography.cities.description')}
      action={
        <div className="flex flex-wrap items-end gap-3">
          <GeographyFilterSelect
            id="geography-city-country-filter"
            label={t('geography.filters.country')}
            value={countryId}
            onChange={handleCountryChange}
            allLabel={t('geography.filters.allCountries')}
            options={countries}
          />
          <GeographyFilterSelect
            id="geography-city-department-filter"
            label={t('geography.filters.department')}
            value={departmentId}
            onChange={setDepartmentId}
            allLabel={t('geography.filters.allDepartments')}
            options={departmentOptions}
          />
          <button className="btn-primary flex items-center gap-2" onClick={onCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            {t('geography.cities.add')}
          </button>
        </div>
      }
      columns={buildCityColumns(onEdit, onDelete, canManage, canManage, t)}
      data={visibleCities}
      isLoading={isLoading}
      error={error}
      searchKey="name"
      searchPlaceholder={t('geography.cities.search')}
      loadingMessage={t('geography.cities.loading')}
      onRetry={onRetry}
    />
  );
}
