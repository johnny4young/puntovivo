import { useTranslation } from 'react-i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import {
  CountryFormModal,
  type CountryFormValues,
} from '@/features/geography/CountryFormModal';
import {
  DepartmentFormModal,
  type DepartmentFormValues,
} from '@/features/geography/DepartmentFormModal';
import { CityFormModal, type CityFormValues } from '@/features/geography/CityFormModal';
import type { City, Country, Department } from '@/types';

interface GeographyDialogsProps {
  countries: Country[];
  departments: Department[];
  editingCountry: Country | null;
  editingDepartment: Department | null;
  editingCity: City | null;
  countryToDelete: Country | null;
  departmentToDelete: Department | null;
  cityToDelete: City | null;
  countryModalKey: number;
  departmentModalKey: number;
  cityModalKey: number;
  isCountryModalOpen: boolean;
  isDepartmentModalOpen: boolean;
  isCityModalOpen: boolean;
  isCountrySaving: boolean;
  isDepartmentSaving: boolean;
  isCitySaving: boolean;
  isCountryDeleting: boolean;
  isDepartmentDeleting: boolean;
  isCityDeleting: boolean;
  countryError: string | null;
  departmentError: string | null;
  cityError: string | null;
  onCloseCountryModal: () => void;
  onCloseDepartmentModal: () => void;
  onCloseCityModal: () => void;
  onSubmitCountry: (values: CountryFormValues) => Promise<void>;
  onSubmitDepartment: (values: DepartmentFormValues) => Promise<void>;
  onSubmitCity: (values: CityFormValues) => Promise<void>;
  onConfirmDeleteCountry: () => void;
  onConfirmDeleteDepartment: () => void;
  onConfirmDeleteCity: () => void;
  onDismissDeleteCountry: () => void;
  onDismissDeleteDepartment: () => void;
  onDismissDeleteCity: () => void;
}

export function GeographyDialogs({
  countries,
  departments,
  editingCountry,
  editingDepartment,
  editingCity,
  countryToDelete,
  departmentToDelete,
  cityToDelete,
  countryModalKey,
  departmentModalKey,
  cityModalKey,
  isCountryModalOpen,
  isDepartmentModalOpen,
  isCityModalOpen,
  isCountrySaving,
  isDepartmentSaving,
  isCitySaving,
  isCountryDeleting,
  isDepartmentDeleting,
  isCityDeleting,
  countryError,
  departmentError,
  cityError,
  onCloseCountryModal,
  onCloseDepartmentModal,
  onCloseCityModal,
  onSubmitCountry,
  onSubmitDepartment,
  onSubmitCity,
  onConfirmDeleteCountry,
  onConfirmDeleteDepartment,
  onConfirmDeleteCity,
  onDismissDeleteCountry,
  onDismissDeleteDepartment,
  onDismissDeleteCity,
}: GeographyDialogsProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      <CountryFormModal
        key={`${editingCountry?.id ?? 'new-country'}-${countryModalKey}`}
        isOpen={isCountryModalOpen}
        country={editingCountry}
        isSaving={isCountrySaving}
        error={countryError}
        onClose={onCloseCountryModal}
        onSubmit={onSubmitCountry}
      />

      <DepartmentFormModal
        key={`${editingDepartment?.id ?? 'new-department'}-${departmentModalKey}`}
        isOpen={isDepartmentModalOpen}
        department={editingDepartment}
        countries={countries}
        isSaving={isDepartmentSaving}
        error={departmentError}
        onClose={onCloseDepartmentModal}
        onSubmit={onSubmitDepartment}
      />

      <CityFormModal
        key={`${editingCity?.id ?? 'new-city'}-${cityModalKey}`}
        isOpen={isCityModalOpen}
        city={editingCity}
        departments={departments}
        isSaving={isCitySaving}
        error={cityError}
        onClose={onCloseCityModal}
        onSubmit={onSubmitCity}
      />

      <ConfirmModal
        isOpen={!!countryToDelete}
        title={t('geography.delete.countryTitle')}
        message={
          countryToDelete
            ? t('geography.delete.countryMessage', { name: countryToDelete.name })
            : ''
        }
        confirmText={isCountryDeleting ? t('geography.delete.deleting') : t('geography.delete.countryConfirm')}
        cancelText={t('geography.form.cancel')}
        variant="danger"
        loading={isCountryDeleting}
        onConfirm={() => {
          onConfirmDeleteCountry();
        }}
        onClose={onDismissDeleteCountry}
      />

      <ConfirmModal
        isOpen={!!departmentToDelete}
        title={t('geography.delete.departmentTitle')}
        message={
          departmentToDelete
            ? t('geography.delete.departmentMessage', { name: departmentToDelete.name })
            : ''
        }
        confirmText={isDepartmentDeleting ? t('geography.delete.deleting') : t('geography.delete.departmentConfirm')}
        cancelText={t('geography.form.cancel')}
        variant="danger"
        loading={isDepartmentDeleting}
        onConfirm={() => {
          onConfirmDeleteDepartment();
        }}
        onClose={onDismissDeleteDepartment}
      />

      <ConfirmModal
        isOpen={!!cityToDelete}
        title={t('geography.delete.cityTitle')}
        message={
          cityToDelete
            ? t('geography.delete.cityMessage', { name: cityToDelete.name })
            : ''
        }
        confirmText={isCityDeleting ? t('geography.delete.deleting') : t('geography.delete.cityConfirm')}
        cancelText={t('geography.form.cancel')}
        variant="danger"
        loading={isCityDeleting}
        onConfirm={() => {
          onConfirmDeleteCity();
        }}
        onClose={onDismissDeleteCity}
      />
    </>
  );
}
