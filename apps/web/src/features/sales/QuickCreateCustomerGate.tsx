/**
 * ENG-105c — Quick-create customer mounter for SalesPage / SalePaymentModal.
 *
 * Subscribes to `useQuickCreateStore.requestedCreateCustomer`. When a
 * request lands, lazily loads the customer-form catalogs
 * (identification, person, regime, client, commercial activity),
 * mounts `CustomerFormModal` with the pre-fill, runs the
 * `customers.create` mutation, and hands the created customer back
 * to the parent via `onCreated`.
 *
 * The component renders null until a request appears, so the catalog
 * queries (~5 small queries) only fire when the cashier triggers
 * the flow. Mirrors `QuickCreateProductGate.tsx`.
 *
 * @module features/sales/QuickCreateCustomerGate
 */

import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  CustomerFormModal,
  type CustomerFormValues,
} from '@/features/customers/CustomerFormModal';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import {
  selectRequestedCreateCustomer,
  useQuickCreateStore,
} from './useQuickCreateStore';
import type { Customer, CustomerCatalogItem } from '@/types';

interface QuickCreateCustomerGateProps {
  /**
   * Fired when a brand-new customer was persisted. The parent uses
   * it for optional side effects; the in-flight sale auto-attach is
   * handled through `pendingCustomerAttachId`.
   */
  onCreated?: (customer: Customer) => void;
}

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function QuickCreateCustomerGate({ onCreated }: QuickCreateCustomerGateProps) {
  const { t } = useTranslation('customers');
  const toast = useToast();
  const utils = trpc.useUtils();
  const requested = useQuickCreateStore(selectRequestedCreateCustomer);
  const consumeCreateCustomer = useQuickCreateStore.getState().consumeCreateCustomer;
  // Parent renders this component conditionally so the modal mounts
  // fresh on every request — no need to manage a key counter.

  const identificationTypesQuery = trpc.identificationTypes.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: requested !== null }
  );
  const personTypesQuery = trpc.personTypes.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: requested !== null }
  );
  const regimeTypesQuery = trpc.regimeTypes.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: requested !== null }
  );
  const clientTypesQuery = trpc.clientTypes.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: requested !== null }
  );
  const commercialActivitiesQuery = trpc.commercialActivities.list.useQuery(
    { page: 1, perPage: 100 },
    { enabled: requested !== null }
  );

  const createMutation = trpc.customers.create.useMutation({
    onError: onErrorToast(toast, t, { titleKey: 'customers:toast.createError' }),
  });

  if (!requested) {
    return null;
  }

  const identificationTypes = (identificationTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const personTypes = (personTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const regimeTypes = (regimeTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const clientTypes = (clientTypesQuery.data?.items ?? []) as CustomerCatalogItem[];
  const commercialActivities = (commercialActivitiesQuery.data?.items ?? []) as CustomerCatalogItem[];

  const handleClose = () => {
    consumeCreateCustomer();
    createMutation.reset();
  };

  const handleSubmit = async (values: CustomerFormValues): Promise<Customer | void> => {
    const created = await createMutation.mutateAsync({
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
    await utils.customers.list.invalidate();
    toast.success({ title: t('toast.created') });
    return created as Customer;
  };

  const handleCreated = (customer: Customer) => {
    // ENG-105c2 — flag the new customer for auto-attach so the next
    // SalePaymentModal mount selects it without a manual pick. The
    // store action runs BEFORE the parent's onCreated callback so a
    // SalesPage handler that observes the store sees the pending id
    // already set.
    useQuickCreateStore.getState().setPendingCustomerAttach(customer.id);
    onCreated?.(customer);
    handleClose();
  };

  return (
    <CustomerFormModal
      isOpen
      customer={null}
      identificationTypes={identificationTypes}
      personTypes={personTypes}
      regimeTypes={regimeTypes}
      clientTypes={clientTypes}
      commercialActivities={commercialActivities}
      isSaving={createMutation.isPending}
      error={createMutation.error?.message ?? null}
      onClose={handleClose}
      onSubmit={handleSubmit}
      defaultName={requested.defaultName ?? undefined}
      onCreated={handleCreated}
    />
  );
}
