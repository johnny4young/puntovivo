import { GeographyDialogs } from '@/features/geography/GeographyDialogs';
import {
  CityCatalogSection,
  CountryCatalogSection,
  DepartmentCatalogSection,
  GeographyTabs,
} from '@/features/geography/GeographyResourceSections';
import { useGeographyManagement } from '@/features/geography/useGeographyManagement';

export function GeographyPage() {
  const geography = useGeographyManagement();

  return (
    <>
      <GeographyTabs activeTab={geography.activeTab} onChange={geography.setActiveTab} />

      {geography.activeTab === 'countries' ? (
        <CountryCatalogSection
          canManage={geography.canManage}
          countries={geography.countries}
          isLoading={geography.countriesQuery.isLoading}
          error={geography.countriesQuery.error?.message ?? null}
          onCreate={geography.openCreateCountry}
          onEdit={geography.openEditCountry}
          onDelete={geography.setCountryToDelete}
          onRetry={() => {
            void geography.countriesQuery.refetch();
          }}
        />
      ) : geography.activeTab === 'departments' ? (
        <DepartmentCatalogSection
          canManage={geography.canManage}
          departments={geography.departments}
          isLoading={geography.departmentsQuery.isLoading}
          error={geography.departmentsQuery.error?.message ?? null}
          onCreate={geography.openCreateDepartment}
          onEdit={geography.openEditDepartment}
          onDelete={geography.setDepartmentToDelete}
          onRetry={() => {
            void geography.departmentsQuery.refetch();
          }}
        />
      ) : (
        <CityCatalogSection
          canManage={geography.canManage}
          cities={geography.cities}
          isLoading={geography.citiesQuery.isLoading}
          error={geography.citiesQuery.error?.message ?? null}
          onCreate={geography.openCreateCity}
          onEdit={geography.openEditCity}
          onDelete={geography.setCityToDelete}
          onRetry={() => {
            void geography.citiesQuery.refetch();
          }}
        />
      )}

      <GeographyDialogs
        countries={geography.countries}
        departments={geography.departments}
        editingCountry={geography.editingCountry}
        editingDepartment={geography.editingDepartment}
        editingCity={geography.editingCity}
        countryToDelete={geography.countryToDelete}
        departmentToDelete={geography.departmentToDelete}
        cityToDelete={geography.cityToDelete}
        countryModalKey={geography.countryModalKey}
        departmentModalKey={geography.departmentModalKey}
        cityModalKey={geography.cityModalKey}
        isCountryModalOpen={geography.isCountryModalOpen}
        isDepartmentModalOpen={geography.isDepartmentModalOpen}
        isCityModalOpen={geography.isCityModalOpen}
        isCountrySaving={geography.isCountrySaving}
        isDepartmentSaving={geography.isDepartmentSaving}
        isCitySaving={geography.isCitySaving}
        isCountryDeleting={geography.isCountryDeleting}
        isDepartmentDeleting={geography.isDepartmentDeleting}
        isCityDeleting={geography.isCityDeleting}
        countryError={geography.countryError}
        departmentError={geography.departmentError}
        cityError={geography.cityError}
        onCloseCountryModal={geography.resetCountryModal}
        onCloseDepartmentModal={geography.resetDepartmentModal}
        onCloseCityModal={geography.resetCityModal}
        onSubmitCountry={geography.handleCountrySubmit}
        onSubmitDepartment={geography.handleDepartmentSubmit}
        onSubmitCity={geography.handleCitySubmit}
        onConfirmDeleteCountry={() => {
          void geography.handleDeleteCountry();
        }}
        onConfirmDeleteDepartment={() => {
          void geography.handleDeleteDepartment();
        }}
        onConfirmDeleteCity={() => {
          void geography.handleDeleteCity();
        }}
        onDismissDeleteCountry={() => {
          if (!geography.isCountryDeleting) {
            geography.setCountryToDelete(null);
          }
        }}
        onDismissDeleteDepartment={() => {
          if (!geography.isDepartmentDeleting) {
            geography.setDepartmentToDelete(null);
          }
        }}
        onDismissDeleteCity={() => {
          if (!geography.isCityDeleting) {
            geography.setCityToDelete(null);
          }
        }}
      />
    </>
  );
}
