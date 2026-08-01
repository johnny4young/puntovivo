import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Modal } from '@/components/form-controls/Modal';
import {
  GeographyHeader,
  GeographyLevelNav,
  GeographyParentContext,
} from '@/features/geography/GeographyWorkflow';
import { useGeographyManagement } from '@/features/geography/useGeographyManagement';

const GeographyDialogs = lazy(() =>
  import('@/features/geography/GeographyDialogs').then(module => ({
    default: module.GeographyDialogs,
  }))
);

const GeographyCatalogPanel = lazy(() =>
  import('@/features/geography/GeographyCatalogPanel').then(module => ({
    default: module.GeographyCatalogPanel,
  }))
);

export function GeographyPage(): React.ReactElement {
  const { t } = useTranslation('geography');
  const geography = useGeographyManagement();
  const panelId = `geography-panel-${geography.activeLevel}`;

  return (
    <>
      <GeographyHeader />
      <GeographyLevelNav
        activeLevel={geography.activeLevel}
        onChange={geography.selectLevel}
      />
      <GeographyParentContext
        activeLevel={geography.activeLevel}
        countries={geography.countries}
        departments={geography.departments}
        selectedCountryId={geography.selectedCountryId}
        selectedDepartmentId={geography.selectedDepartmentId}
        isCountriesLoading={geography.countriesQuery.isLoading}
        isDepartmentsLoading={geography.departmentsQuery.isLoading}
        onCountryChange={geography.selectCountry}
        onDepartmentChange={geography.selectDepartment}
      />

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`geography-tab-${geography.activeLevel}`}
      >
        <Suspense fallback={<div className="min-h-64 rounded-[1.5rem] bg-surface-2" />}>
          <GeographyCatalogPanel geography={geography} />
        </Suspense>
      </div>

      {!geography.canManage ? (
        <div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('permissionNote')}
        </div>
      ) : null}

      {geography.hasOpenDialog ? (
        <Suspense
          fallback={
            <Modal
              isOpen
              onClose={() => undefined}
              title={t('dialogs.loadingTitle')}
              size="lg"
              closeOnBackdrop={false}
              closeOnEsc={false}
              showCloseButton={false}
            >
              <div
                className="flex min-h-52 flex-col items-center justify-center gap-3 text-center"
                role="status"
              >
                <LoaderCircle
                  className="h-6 w-6 animate-spin text-primary-700"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-secondary-700">
                  {t('dialogs.loadingMessage')}
                </p>
              </div>
            </Modal>
          }
        >
          <GeographyDialogs
            countries={geography.countries}
            departments={geography.cityFormDepartments}
            defaultCountryId={geography.selectedCountryId}
            defaultDepartmentId={geography.selectedDepartmentId}
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
            onConfirmDeleteCountry={() => void geography.handleDeleteCountry()}
            onConfirmDeleteDepartment={() => void geography.handleDeleteDepartment()}
            onConfirmDeleteCity={() => void geography.handleDeleteCity()}
            onDismissDeleteCountry={() => {
              if (!geography.isCountryDeleting) geography.setCountryToDelete(null);
            }}
            onDismissDeleteDepartment={() => {
              if (!geography.isDepartmentDeleting) geography.setDepartmentToDelete(null);
            }}
            onDismissDeleteCity={() => {
              if (!geography.isCityDeleting) geography.setCityToDelete(null);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
