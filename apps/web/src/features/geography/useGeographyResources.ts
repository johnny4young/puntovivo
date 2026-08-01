import { useTranslation } from 'react-i18next';

import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { City, Country, Department } from '@/types';
import type { GeographyLevel } from './geography.types';

const COUNTRY_LIST_INPUT = { page: 1, perPage: 100 } as const;

export function useGeographyResources({
  activeLevel,
  selectedCountryId,
  selectedDepartmentId,
  isCityModalOpen,
}: {
  activeLevel: GeographyLevel;
  selectedCountryId: string;
  selectedDepartmentId: string;
  isCityModalOpen: boolean;
}) {
  const { t } = useTranslation('geography');
  const utils = trpc.useUtils();

  const countriesQuery = trpc.countries.list.useQuery(COUNTRY_LIST_INPUT);
  const countries: Country[] = (countriesQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));
  const resolvedCountryId =
    countriesQuery.data &&
    selectedCountryId &&
    !countries.some(country => country.id === selectedCountryId)
      ? ''
      : selectedCountryId;

  const departmentsQuery = trpc.departments.list.useQuery(
    {
      page: 1,
      perPage: 100,
      ...(resolvedCountryId ? { countryId: resolvedCountryId } : {}),
    },
    { enabled: activeLevel !== 'countries' && resolvedCountryId.length > 0 }
  );
  const departments: Department[] = (departmentsQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));
  const resolvedDepartmentId =
    departmentsQuery.data &&
    selectedDepartmentId &&
    !departments.some(department => department.id === selectedDepartmentId)
      ? ''
      : selectedDepartmentId;

  const citiesQuery = trpc.cities.list.useQuery(
    {
      page: 1,
      perPage: 200,
      ...(resolvedDepartmentId ? { departmentId: resolvedDepartmentId } : {}),
    },
    { enabled: activeLevel === 'cities' && resolvedDepartmentId.length > 0 }
  );
  const cityFormDepartmentsQuery = trpc.departments.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: isCityModalOpen }
  );

  const cities: City[] = (citiesQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));
  const cityFormDepartments: Department[] = (
    cityFormDepartmentsQuery.data?.items ??
    departmentsQuery.data?.items ??
    []
  ).map(item => ({ ...item, isActive: item.isActive ?? false }));

  const createCountry = trpc.countries.create.useMutation();
  const updateCountry = trpc.countries.update.useMutation();
  const deleteCountry = trpc.countries.delete.useMutation();
  const createDepartment = trpc.departments.create.useMutation();
  const updateDepartment = trpc.departments.update.useMutation();
  const deleteDepartment = trpc.departments.delete.useMutation();
  const createCity = trpc.cities.create.useMutation();
  const updateCity = trpc.cities.update.useMutation();
  const deleteCity = trpc.cities.delete.useMutation();

  const countryMutationError = createCountry.error ?? updateCountry.error;
  const departmentMutationError = createDepartment.error ?? updateDepartment.error;
  const cityMutationError = createCity.error ?? updateCity.error;

  return {
    countries,
    departments,
    cities,
    cityFormDepartments,
    resolvedCountryId,
    resolvedDepartmentId,
    selectedCountry: countries.find(country => country.id === resolvedCountryId) ?? null,
    selectedDepartment:
      departments.find(department => department.id === resolvedDepartmentId) ?? null,
    countriesQuery,
    departmentsQuery,
    citiesQuery,
    createCountry,
    updateCountry,
    deleteCountry,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    createCity,
    updateCity,
    deleteCity,
    invalidate: () =>
      Promise.all([
        utils.countries.list.invalidate(),
        utils.departments.list.invalidate(),
        utils.cities.list.invalidate(),
      ]),
    countryError: countryMutationError
      ? translateServerError(countryMutationError, t, t('toasts.countrySaveError'))
      : null,
    departmentError: departmentMutationError
      ? translateServerError(departmentMutationError, t, t('toasts.departmentSaveError'))
      : null,
    cityError: cityMutationError
      ? translateServerError(cityMutationError, t, t('toasts.citySaveError'))
      : null,
  };
}
