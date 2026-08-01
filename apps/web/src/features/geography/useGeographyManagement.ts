import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import type { CityFormValues } from '@/features/geography/CityFormModal';
import type { CountryFormValues } from '@/features/geography/CountryFormModal';
import type { DepartmentFormValues } from '@/features/geography/DepartmentFormModal';
import type { GeographyLevel } from '@/features/geography/geography.types';
import { useGeographyResources } from '@/features/geography/useGeographyResources';
import { translateServerError } from '@/lib/translateServerError';
import type { City, Country, Department } from '@/types';

export function useGeographyManagement() {
  const { user } = useAuth();
  const { t } = useTranslation('geography');
  const toast = useToast();
  const canManage = user?.role === 'admin';

  const [activeLevel, setActiveLevel] = useState<GeographyLevel>('countries');
  const [selectedCountryId, setSelectedCountryId] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [isCountryModalOpen, setIsCountryModalOpen] = useState(false);
  const [isDepartmentModalOpen, setIsDepartmentModalOpen] = useState(false);
  const [isCityModalOpen, setIsCityModalOpen] = useState(false);
  const [countryModalKey, setCountryModalKey] = useState(0);
  const [departmentModalKey, setDepartmentModalKey] = useState(0);
  const [cityModalKey, setCityModalKey] = useState(0);
  const [editingCountry, setEditingCountry] = useState<Country | null>(null);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null);
  const [editingCity, setEditingCity] = useState<City | null>(null);
  const [countryToDelete, setCountryToDelete] = useState<Country | null>(null);
  const [departmentToDelete, setDepartmentToDelete] = useState<Department | null>(null);
  const [cityToDelete, setCityToDelete] = useState<City | null>(null);

  const resource = useGeographyResources({
    activeLevel,
    selectedCountryId,
    selectedDepartmentId,
    isCityModalOpen,
  });

  function selectLevel(level: GeographyLevel) {
    setActiveLevel(level);
    setCountryToDelete(null);
    setDepartmentToDelete(null);
    setCityToDelete(null);
  }

  function selectCountry(countryId: string) {
    setSelectedCountryId(countryId);
    setSelectedDepartmentId('');
  }

  function openCountryChildren(country: Country) {
    selectCountry(country.id);
    selectLevel('departments');
  }

  function openDepartmentChildren(department: Department) {
    if (department.countryId) setSelectedCountryId(department.countryId);
    setSelectedDepartmentId(department.id);
    selectLevel('cities');
  }

  function resetCountryModal() {
    setIsCountryModalOpen(false);
    setEditingCountry(null);
    resource.createCountry.reset();
    resource.updateCountry.reset();
  }

  function resetDepartmentModal() {
    setIsDepartmentModalOpen(false);
    setEditingDepartment(null);
    resource.createDepartment.reset();
    resource.updateDepartment.reset();
  }

  function resetCityModal() {
    setIsCityModalOpen(false);
    setEditingCity(null);
    resource.createCity.reset();
    resource.updateCity.reset();
  }

  async function handleCountrySubmit(values: CountryFormValues) {
    const payload = {
      code: values.code.trim(),
      name: values.name.trim(),
      isActive: values.isActive,
    };

    try {
      if (editingCountry) {
        await resource.updateCountry.mutateAsync({ id: editingCountry.id, ...payload });
        toast.success({ title: t('toasts.countryUpdated') });
      } else {
        await resource.createCountry.mutateAsync(payload);
        toast.success({ title: t('toasts.countryCreated') });
      }
      await resource.invalidate();
      resetCountryModal();
    } catch (error) {
      showMutationError(error, 'toasts.countrySaveError');
    }
  }

  async function handleDepartmentSubmit(values: DepartmentFormValues) {
    const payload = {
      countryId: values.countryId,
      code: values.code.trim(),
      name: values.name.trim(),
      isActive: values.isActive,
    };

    try {
      if (editingDepartment) {
        await resource.updateDepartment.mutateAsync({ id: editingDepartment.id, ...payload });
        toast.success({ title: t('toasts.departmentUpdated') });
      } else {
        await resource.createDepartment.mutateAsync(payload);
        toast.success({ title: t('toasts.departmentCreated') });
      }
      if (values.countryId !== resource.resolvedCountryId) selectCountry(values.countryId);
      await resource.invalidate();
      resetDepartmentModal();
    } catch (error) {
      showMutationError(error, 'toasts.departmentSaveError');
    }
  }

  async function handleCitySubmit(values: CityFormValues) {
    const payload = {
      departmentId: values.departmentId,
      code: values.code.trim(),
      name: values.name.trim(),
      isActive: values.isActive,
    };

    try {
      if (editingCity) {
        await resource.updateCity.mutateAsync({ id: editingCity.id, ...payload });
        toast.success({ title: t('toasts.cityUpdated') });
      } else {
        await resource.createCity.mutateAsync(payload);
        toast.success({ title: t('toasts.cityCreated') });
      }

      const nextDepartment = resource.cityFormDepartments.find(
        department => department.id === values.departmentId
      );
      if (nextDepartment?.countryId && nextDepartment.countryId !== resource.resolvedCountryId) {
        setSelectedCountryId(nextDepartment.countryId);
      }
      setSelectedDepartmentId(values.departmentId);
      await resource.invalidate();
      resetCityModal();
    } catch (error) {
      showMutationError(error, 'toasts.citySaveError');
    }
  }

  async function handleDeleteCountry() {
    if (!countryToDelete) return;
    try {
      await resource.deleteCountry.mutateAsync({ id: countryToDelete.id });
      if (countryToDelete.id === resource.resolvedCountryId) selectCountry('');
      await resource.invalidate();
      setCountryToDelete(null);
      toast.success({ title: t('toasts.countryDeleted') });
    } catch (error) {
      showMutationError(error, 'toasts.countryDeleteError');
    }
  }

  async function handleDeleteDepartment() {
    if (!departmentToDelete) return;
    try {
      await resource.deleteDepartment.mutateAsync({ id: departmentToDelete.id });
      if (departmentToDelete.id === resource.resolvedDepartmentId) {
        setSelectedDepartmentId('');
      }
      await resource.invalidate();
      setDepartmentToDelete(null);
      toast.success({ title: t('toasts.departmentDeleted') });
    } catch (error) {
      showMutationError(error, 'toasts.departmentDeleteError');
    }
  }

  async function handleDeleteCity() {
    if (!cityToDelete) return;
    try {
      await resource.deleteCity.mutateAsync({ id: cityToDelete.id });
      await resource.invalidate();
      setCityToDelete(null);
      toast.success({ title: t('toasts.cityDeleted') });
    } catch (error) {
      showMutationError(error, 'toasts.cityDeleteError');
    }
  }

  function showMutationError(error: unknown, key: string) {
    const fallback = t(key);
    toast.error({ title: fallback, description: translateServerError(error, t, fallback) });
  }

  return {
    canManage,
    activeLevel,
    selectLevel,
    selectedCountryId: resource.resolvedCountryId,
    selectedDepartmentId: resource.resolvedDepartmentId,
    selectedCountry: resource.selectedCountry,
    selectedDepartment: resource.selectedDepartment,
    selectCountry,
    selectDepartment: setSelectedDepartmentId,
    openCountryChildren,
    openDepartmentChildren,
    countries: resource.countries,
    departments: resource.departments,
    cities: resource.cities,
    cityFormDepartments: resource.cityFormDepartments,
    countriesQuery: resource.countriesQuery,
    departmentsQuery: resource.departmentsQuery,
    citiesQuery: resource.citiesQuery,
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
    hasOpenDialog:
      isCountryModalOpen ||
      isDepartmentModalOpen ||
      isCityModalOpen ||
      !!countryToDelete ||
      !!departmentToDelete ||
      !!cityToDelete,
    openCreateCountry() {
      setEditingCountry(null);
      setCountryModalKey(current => current + 1);
      setIsCountryModalOpen(true);
    },
    openEditCountry(country: Country) {
      setEditingCountry(country);
      setCountryModalKey(current => current + 1);
      setIsCountryModalOpen(true);
    },
    openCreateDepartment() {
      if (!resource.resolvedCountryId) return;
      setEditingDepartment(null);
      setDepartmentModalKey(current => current + 1);
      setIsDepartmentModalOpen(true);
    },
    openEditDepartment(department: Department) {
      setEditingDepartment(department);
      setDepartmentModalKey(current => current + 1);
      setIsDepartmentModalOpen(true);
    },
    openCreateCity() {
      if (!resource.resolvedDepartmentId) return;
      setEditingCity(null);
      setCityModalKey(current => current + 1);
      setIsCityModalOpen(true);
    },
    openEditCity(city: City) {
      setEditingCity(city);
      setCityModalKey(current => current + 1);
      setIsCityModalOpen(true);
    },
    setCountryToDelete,
    setDepartmentToDelete,
    setCityToDelete,
    resetCountryModal,
    resetDepartmentModal,
    resetCityModal,
    handleCountrySubmit,
    handleDepartmentSubmit,
    handleCitySubmit,
    handleDeleteCountry,
    handleDeleteDepartment,
    handleDeleteCity,
    isCountrySaving: resource.createCountry.isPending || resource.updateCountry.isPending,
    isDepartmentSaving: resource.createDepartment.isPending || resource.updateDepartment.isPending,
    isCitySaving: resource.createCity.isPending || resource.updateCity.isPending,
    isCountryDeleting: resource.deleteCountry.isPending,
    isDepartmentDeleting: resource.deleteDepartment.isPending,
    isCityDeleting: resource.deleteCity.isPending,
    countryError: resource.countryError,
    departmentError: resource.departmentError,
    cityError: resource.cityError,
  };
}
