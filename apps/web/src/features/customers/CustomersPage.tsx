import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2, BookOpen, Eye } from 'lucide-react';
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
import { CustomerDetailsDrawer } from '@/features/customers/CustomerDetailsDrawer';
import { resolveCatalogLabel } from '@/features/customers/catalogLabel';
import { CustomerLedgerModal } from '@/features/customers/CustomerLedgerModal';
import { EmptyStateReadinessNudge } from '@/components/feedback/EmptyStateReadinessNudge';
import { onErrorToast } from '@/lib/mutationHelpers';
import { extractServerErrorCode } from '@/lib/translateServerError';

function toOptionalString(value: string): string | undefined {
  return value || undefined;
}

function toNullableString(value: string): string | null {
  return value || null;
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
  // ENG-089 — V5 ledger panel mounting state. Manager + admin only;
  // the row action button is hidden for cashier roles via `canViewLedger`.
  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  // ENG-132b — row-detail Drawer for the columns trimmed off the default
  // table (email / phone / type / location + identification).
  const [detailsCustomer, setDetailsCustomer] = useState<Customer | null>(null);

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
    // ENG-177a — refresh the cached list on a STALE_VERSION conflict so the
    // next edit loads the latest version.
    onError: onErrorToast(toast, t, {
      titleKey: 'customers:toast.updateError',
      extra: (_description, error) => {
        if (extractServerErrorCode(error) === 'STALE_VERSION') {
          void utils.customers.list.invalidate();
        }
      },
    }),
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
  // ENG-089 — `Estado cuenta` row action mirrors the server's
  // `customerLedger.list` manager+ gate; cashier never sees the
  // button.
  const canViewLedger = user?.role === 'admin' || user?.role === 'manager';
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
        // ENG-177a — round-trip the loaded version for the concurrency guard.
        version: editingCustomer.version,
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
        // ENG-089 — `creditLimit` always sends a number; the form
        // coerces undefined to 0 via the default value.
        creditLimit: Number.isFinite(values.creditLimit) ? values.creditLimit : 0,
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
      creditLimit: Number.isFinite(values.creditLimit) ? values.creditLimit : 0,
      isActive: values.isActive,
    });
  };

  const columns: ColumnDef<Customer>[] = [
    {
      accessorKey: 'name',
      header: () => i18next.t('customers:table.name'),
      size: 240,
      // Rediseño FASE 3 — celda ancla (.pv-table .prod): avatar con la
      // inicial + nombre fuerte + identificación legible (tipo + taxId,
      // nunca el id interno) en mono debajo.
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">{row.original.name.charAt(0).toUpperCase()}</span>
          <div>
            <p className="pname">{row.original.name}</p>
            <p className="sku">
              {resolveCatalogLabel(identificationTypes, row.original.identificationTypeId) || 'ID'}{' '}
              {row.original.taxId || 'Not set'}
            </p>
          </div>
        </div>
      ),
    },
    // ENG-132b — email / phone / type / location trimmed from the default
    // table into the row-detail Drawer (`onViewDetails`) so the row stays
    // narrow; name + status carry the at-a-glance signal.
    {
      accessorKey: 'isActive',
      header: () => i18next.t('customers:table.status'),
      size: 100,
      cell: ({ row }) => (
        <span className={`pv-badge ${row.original.isActive ? 'success' : 'neutral'}`}>
          {row.original.isActive ? i18next.t('customers:table.active') : i18next.t('customers:table.inactive')}
        </span>
      ),
    },
    {
      id: 'actions',
      size: 150,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {/* ENG-132b — Details is the progressive-disclosure affordance for
              the trimmed columns (email / phone / type / location); all
              roles, focusable in tab order. */}
          <button
            className="btn-ghost btn-icon h-8 w-8"
            aria-label={i18next.t('customers:details.viewAria')}
            title={i18next.t('customers:details.viewAria')}
            onClick={() => setDetailsCustomer(row.original)}
          >
            <Eye className="h-4 w-4" />
          </button>
          {canViewLedger && (
            <button
              className="btn-ghost btn-icon h-8 w-8"
              data-testid={`customer-ledger-${row.original.id}`}
              // ENG-089 — the row action opens the full ledger panel
              // (the panel itself exposes the CSV export CTA). Use
              // `verCuenta` for the affordance label so screen-reader
              // users hear "View account" instead of "Statement".
              aria-label={i18next.t('customers:ledger.cta.verCuenta')}
              title={i18next.t('customers:ledger.cta.verCuenta')}
              onClick={() => setLedgerCustomer(row.original)}
            >
              <BookOpen className="h-4 w-4" />
            </button>
          )}
          <button
            className="btn-ghost btn-icon h-8 w-8"
            // ENG-134 slice B: icon-only buttons must declare an
            // accessible name. axe-core flagged the original button
            // with `button-name [critical]`. Pair `aria-label` with
            // `title` so the affordance is also visible to mouse
            // users on hover.
            aria-label={i18next.t('common:actions.edit')}
            title={i18next.t('common:actions.edit')}
            onClick={() => handleOpenEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
              aria-label={i18next.t('common:actions.delete')}
              title={i18next.t('common:actions.delete')}
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
      {/* ENG-104 — fresh tenant nudge toward the readiness checklist.
          The nudge gates to admin because the target setup surface is admin-only. */}
      {!isLoading && !error && customers.length === 0 && (
        <div className="mb-4">
          <EmptyStateReadinessNudge scope="customers" />
        </div>
      )}
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
        // ENG-134f — Enter / Space on a focused row opens the edit
        // modal, mirroring the row's Pencil button click.
        onRowActivate={handleOpenEdit}
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

      {/* ENG-089 — V5 "Cuenta corriente" panel for the selected
          customer. Manager + admin only; cashier never reaches this
          surface because the row action button is hidden for them. */}
      <CustomerLedgerModal
        isOpen={!!ledgerCustomer}
        customer={ledgerCustomer}
        onClose={() => setLedgerCustomer(null)}
      />

      <CustomerDetailsDrawer
        customer={detailsCustomer}
        identificationTypes={identificationTypes}
        clientTypes={clientTypes}
        onClose={() => setDetailsCustomer(null)}
        onEdit={customer => {
          setDetailsCustomer(null);
          handleOpenEdit(customer);
        }}
      />
    </>
  );
}
