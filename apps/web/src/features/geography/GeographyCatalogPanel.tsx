import {
  CityCatalogSection,
  CountryCatalogSection,
  DepartmentCatalogSection,
} from '@/features/geography/GeographyResourceSections';
import { GeographyPrerequisite } from '@/features/geography/GeographyWorkflow';
import type { useGeographyManagement } from '@/features/geography/useGeographyManagement';

type GeographyManagement = ReturnType<typeof useGeographyManagement>;

export function GeographyCatalogPanel({
  geography,
}: {
  geography: GeographyManagement;
}): React.ReactElement {
  if (geography.activeLevel === 'countries') {
    return (
      <CountryCatalogSection
        canManage={geography.canManage}
        countries={geography.countries}
        isLoading={geography.countriesQuery.isLoading}
        error={geography.countriesQuery.error?.message ?? null}
        onCreate={geography.openCreateCountry}
        onEdit={geography.openEditCountry}
        onDelete={geography.setCountryToDelete}
        onOpenDepartments={geography.openCountryChildren}
        onRetry={() => void geography.countriesQuery.refetch()}
      />
    );
  }

  if (geography.activeLevel === 'departments') {
    return geography.selectedCountry ? (
      <DepartmentCatalogSection
        canManage={geography.canManage}
        country={geography.selectedCountry}
        departments={geography.departments}
        isLoading={geography.departmentsQuery.isLoading}
        error={geography.departmentsQuery.error?.message ?? null}
        onCreate={geography.openCreateDepartment}
        onEdit={geography.openEditDepartment}
        onDelete={geography.setDepartmentToDelete}
        onOpenCities={geography.openDepartmentChildren}
        onRetry={() => void geography.departmentsQuery.refetch()}
      />
    ) : (
      <GeographyPrerequisite level="departments" />
    );
  }

  return geography.selectedDepartment ? (
    <CityCatalogSection
      canManage={geography.canManage}
      department={geography.selectedDepartment}
      cities={geography.cities}
      isLoading={geography.citiesQuery.isLoading}
      error={geography.citiesQuery.error?.message ?? null}
      onCreate={geography.openCreateCity}
      onEdit={geography.openEditCity}
      onDelete={geography.setCityToDelete}
      onRetry={() => void geography.citiesQuery.refetch()}
    />
  ) : (
    <GeographyPrerequisite level="cities" />
  );
}
