import { useState } from 'react';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import type { CityFormValues } from '@/features/geography/CityFormModal';
import type { CountryFormValues } from '@/features/geography/CountryFormModal';
import type { DepartmentFormValues } from '@/features/geography/DepartmentFormModal';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';
import type { City, Country, Department } from '@/types';

export type GeographyTab = 'countries' | 'departments' | 'cities';

export function useGeographyManagement() {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const canManage = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<GeographyTab>('countries');
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

  const countriesQuery = trpc.countries.list.useQuery({ page: 1, perPage: 100 });
  const departmentsQuery = trpc.departments.list.useQuery({ page: 1, perPage: 100 });
  const citiesQuery = trpc.cities.list.useQuery({ page: 1, perPage: 200 });

  const createCountryMutation = trpc.countries.create.useMutation();
  const updateCountryMutation = trpc.countries.update.useMutation();
  const deleteCountryMutation = trpc.countries.delete.useMutation();
  const createDepartmentMutation = trpc.departments.create.useMutation();
  const updateDepartmentMutation = trpc.departments.update.useMutation();
  const deleteDepartmentMutation = trpc.departments.delete.useMutation();
  const createCityMutation = trpc.cities.create.useMutation();
  const updateCityMutation = trpc.cities.update.useMutation();
  const deleteCityMutation = trpc.cities.delete.useMutation();

  const countries: Country[] = (countriesQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));
  const departments: Department[] = (departmentsQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));
  const cities: City[] = (citiesQuery.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));

  async function invalidateGeography() {
    await Promise.all([
      utils.countries.list.invalidate(),
      utils.departments.list.invalidate(),
      utils.cities.list.invalidate(),
    ]);
  }

  function resetCountryModal() {
    setIsCountryModalOpen(false);
    setEditingCountry(null);
    createCountryMutation.reset();
    updateCountryMutation.reset();
  }

  function resetDepartmentModal() {
    setIsDepartmentModalOpen(false);
    setEditingDepartment(null);
    createDepartmentMutation.reset();
    updateDepartmentMutation.reset();
  }

  function resetCityModal() {
    setIsCityModalOpen(false);
    setEditingCity(null);
    createCityMutation.reset();
    updateCityMutation.reset();
  }

  async function handleCountrySubmit(values: CountryFormValues) {
    const payload = {
      code: values.code.trim(),
      name: values.name.trim(),
      isActive: values.isActive,
    };

    try {
      if (editingCountry) {
        await updateCountryMutation.mutateAsync({ id: editingCountry.id, ...payload });
        toast.success({ title: 'Country updated' });
      } else {
        await createCountryMutation.mutateAsync(payload);
        toast.success({ title: 'Country created' });
      }

      await invalidateGeography();
      resetCountryModal();
    } catch (error) {
      toast.error({
        title: 'Unable to save country',
        description: getErrorMessage(error, 'Unable to save country'),
      });
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
        await updateDepartmentMutation.mutateAsync({ id: editingDepartment.id, ...payload });
        toast.success({ title: 'Department updated' });
      } else {
        await createDepartmentMutation.mutateAsync(payload);
        toast.success({ title: 'Department created' });
      }

      await invalidateGeography();
      resetDepartmentModal();
    } catch (error) {
      toast.error({
        title: 'Unable to save department',
        description: getErrorMessage(error, 'Unable to save department'),
      });
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
        await updateCityMutation.mutateAsync({ id: editingCity.id, ...payload });
        toast.success({ title: 'City updated' });
      } else {
        await createCityMutation.mutateAsync(payload);
        toast.success({ title: 'City created' });
      }

      await invalidateGeography();
      resetCityModal();
    } catch (error) {
      toast.error({
        title: 'Unable to save city',
        description: getErrorMessage(error, 'Unable to save city'),
      });
    }
  }

  async function handleDeleteCountry() {
    if (!countryToDelete) return;

    try {
      await deleteCountryMutation.mutateAsync({ id: countryToDelete.id });
      await invalidateGeography();
      setCountryToDelete(null);
      toast.success({ title: 'Country deleted' });
    } catch (error) {
      toast.error({
        title: 'Unable to delete country',
        description: getErrorMessage(error, 'Unable to delete country'),
      });
    }
  }

  async function handleDeleteDepartment() {
    if (!departmentToDelete) return;

    try {
      await deleteDepartmentMutation.mutateAsync({ id: departmentToDelete.id });
      await invalidateGeography();
      setDepartmentToDelete(null);
      toast.success({ title: 'Department deleted' });
    } catch (error) {
      toast.error({
        title: 'Unable to delete department',
        description: getErrorMessage(error, 'Unable to delete department'),
      });
    }
  }

  async function handleDeleteCity() {
    if (!cityToDelete) return;

    try {
      await deleteCityMutation.mutateAsync({ id: cityToDelete.id });
      await invalidateGeography();
      setCityToDelete(null);
      toast.success({ title: 'City deleted' });
    } catch (error) {
      toast.error({
        title: 'Unable to delete city',
        description: getErrorMessage(error, 'Unable to delete city'),
      });
    }
  }

  return {
    canManage,
    activeTab,
    setActiveTab,
    countries,
    departments,
    cities,
    countriesQuery,
    departmentsQuery,
    citiesQuery,
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
    isCountrySaving: createCountryMutation.isPending || updateCountryMutation.isPending,
    isDepartmentSaving: createDepartmentMutation.isPending || updateDepartmentMutation.isPending,
    isCitySaving: createCityMutation.isPending || updateCityMutation.isPending,
    isCountryDeleting: deleteCountryMutation.isPending,
    isDepartmentDeleting: deleteDepartmentMutation.isPending,
    isCityDeleting: deleteCityMutation.isPending,
    countryError: createCountryMutation.error?.message ?? updateCountryMutation.error?.message ?? null,
    departmentError:
      createDepartmentMutation.error?.message ?? updateDepartmentMutation.error?.message ?? null,
    cityError: createCityMutation.error?.message ?? updateCityMutation.error?.message ?? null,
  };
}
