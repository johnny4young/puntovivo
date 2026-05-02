import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Customer, CustomerCatalogItem } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  CustomerFormModal,
  type CustomerFormValues,
} from '@/features/customers/CustomerFormModal';
import { onErrorToast } from '@/lib/mutationHelpers';

function toOptionalString(value: string): string | undefined {
  return value || undefined;
}

function toNullableString(value: string): string | null {
  return value || null;
}

function formatLocation(customer: Customer): string {
  const location = [customer.city, customer.state].filter(Boolean).join(', ');
  return location || customer.country || '-';
}

export function CustomersPage() {
  const { t } = useTranslation('customers');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  const { data, isLoading, error, refetch } = trpc.customers.list.useQuery({ page: 1, perPage: 50 });
  const identificationTypesQuery = trpc.identificationTypes.list.useQuery({ page: 1, perPage: 100 });
  const personTypesQuery = trpc.personTypes.list.useQuery({ page: 1, perPage: 100 });
  const regimeTypesQuery = trpc.regimeTypes.list.useQuery({ page: 1, perPage: 100 });
  const clientTypesQuery = trpc.clientTypes.list.useQuery({ page: 1, perPage: 100 });
  const commercialActivitiesQuery = trpc.commercialActivities.list.useQuery({ page: 1, perPage: 100 });
  const createMutation = trpc.customers.create.useMutation({
    onSuccess: async () => {
      await utils.customers.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'customers:toast.createError' }),
  });
  const updateMutation = trpc.customers.update.useMutation({
    onSuccess: async () => {
      await utils.customers.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'customers:toast.updateError' }),
  });

  const deleteMutation = trpc.customers.delete.useMutation({
    onSuccess: async () => {
      await utils.customers.list.invalidate();
      setCustomerToDelete(null);
      toast.success({ title: t('toast.deleted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'customers:toast.deleteError' }),
  });

  const canDelete = user?.role === 'admin';
  const customers = (data?.items ?? []).map(customer => ({
    ...customer,
    isActive: customer.isActive ?? false,
  })) as Customer[];
  const identificationTypes = (identificationTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const personTypes = (personTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const regimeTypes = (regimeTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const clientTypes = (clientTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const commercialActivities = (commercialActivitiesQuery.data?.items ?? []) as CustomerCatalogItem[];

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingCustomer(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleSubmit = async (values: CustomerFormValues) => {
    if (editingCustomer) {
      await updateMutation.mutateAsync({
        id: editingCustomer.id,
        name: values.name,
        email: toNullableString(values.email),
        phone: toNullableString(values.phone),
        address: toNullableString(values.address),
        city: toNullableString(values.city),
        state: toNullableString(values.state),
        postalCode: toNullableString(values.postalCode),
        country: toNullableString(values.country),
        taxId: toNullableString(values.taxId),
        identificationTypeId: toNullableString(values.identificationTypeId),
        personTypeId: toNullableString(values.personTypeId),
        regimeTypeId: toNullableString(values.regimeTypeId),
        clientTypeId: toNullableString(values.clientTypeId),
        commercialActivityId: toNullableString(values.commercialActivityId),
        notes: toNullableString(values.notes),
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync({
      name: values.name,
      email: toOptionalString(values.email),
      phone: toOptionalString(values.phone),
      address: toOptionalString(values.address),
      city: toOptionalString(values.city),
      state: toOptionalString(values.state),
      postalCode: toOptionalString(values.postalCode),
      country: toOptionalString(values.country),
      taxId: toOptionalString(values.taxId),
      identificationTypeId: toOptionalString(values.identificationTypeId),
      personTypeId: toOptionalString(values.personTypeId),
      regimeTypeId: toOptionalString(values.regimeTypeId),
      clientTypeId: toOptionalString(values.clientTypeId),
      commercialActivityId: toOptionalString(values.commercialActivityId),
      notes: toOptionalString(values.notes),
      isActive: values.isActive,
    });
  };

  const columns: ColumnDef<Customer>[] = [
    {
      accessorKey: 'name',
      header: () => i18next.t('customers:table.name'),
      size: 240,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-sm font-medium text-primary-700">
              {row.original.name.charAt(0)}
            </span>
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">
              {row.original.identificationTypeId || 'ID'} {row.original.taxId || 'Not set'}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: () => i18next.t('customers:table.email'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-secondary-600">
          <Mail className="h-4 w-4" />
          {row.original.email || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'phone',
      header: () => i18next.t('customers:table.phone'),
      size: 160,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-secondary-600">
          <Phone className="h-4 w-4" />
          {row.original.phone || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'clientTypeId',
      header: () => i18next.t('customers:table.type'),
      size: 140,
      cell: ({ row }) => row.original.clientTypeId || '-',
    },
    {
      accessorKey: 'city',
      header: () => i18next.t('customers:table.location'),
      size: 180,
      cell: ({ row }) => <span className="text-secondary-600">{formatLocation(row.original)}</span>,
    },
    {
      accessorKey: 'isActive',
      header: () => i18next.t('customers:table.status'),
      size: 100,
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
          {row.original.isActive ? i18next.t('customers:table.active') : i18next.t('customers:table.inactive')}
        </span>
      ),
    },
    {
      id: 'actions',
      size: 80,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button className="btn-ghost btn-icon h-8 w-8" onClick={() => handleOpenEdit(row.original)}>
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
              onClick={() => setCustomerToDelete(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ResourcePage
        title={t('page.title')}
        action={
          <button className="btn-primary flex items-center gap-2" onClick={handleOpenCreate}>
            <Plus className="h-5 w-5" />
            {t('page.add')}
          </button>
        }
        columns={columns}
        data={customers}
        isLoading={isLoading}
        error={error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('table.search')}
        loadingMessage={t('table.loading')}
        onRetry={() => {
          void refetch();
        }}
      />

      <CustomerFormModal
        key={`${editingCustomer?.id ?? 'new-customer'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        customer={editingCustomer}
        identificationTypes={identificationTypes}
        personTypes={personTypes}
        regimeTypes={regimeTypes}
        clientTypes={clientTypes}
        commercialActivities={commercialActivities}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!customerToDelete}
        onClose={() => setCustomerToDelete(null)}
        onConfirm={() => {
          if (customerToDelete) {
            void deleteMutation.mutateAsync({ id: customerToDelete.id });
          }
        }}
        title={t('delete.title')}
        message={t('delete.description')}
        confirmText={t('delete.title')}
        loading={deleteMutation.isPending}
      />
    </>
  );
}
