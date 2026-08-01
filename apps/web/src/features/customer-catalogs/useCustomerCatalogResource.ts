import { trpc } from '@/lib/trpc';
import type { CustomerCatalogItem } from '@/types';
import type { CustomerCatalogKey } from './customerCatalogConfig';

const LIST_INPUT = { page: 1, perPage: 100 } as const;

/**
 * Keeps all React hook calls stable while allowing only the catalog currently
 * visible to perform a list request. Mutation observers do not issue network
 * requests until the selected resource invokes them.
 */
export function useCustomerCatalogResource(activeCatalog: CustomerCatalogKey) {
  const utils = trpc.useUtils();

  const identificationTypes = {
    query: trpc.identificationTypes.list.useQuery(LIST_INPUT, {
      enabled: activeCatalog === 'identificationTypes',
    }),
    create: trpc.identificationTypes.create.useMutation(),
    update: trpc.identificationTypes.update.useMutation(),
    delete: trpc.identificationTypes.delete.useMutation(),
    invalidate: () => utils.identificationTypes.list.invalidate(),
  };
  const personTypes = {
    query: trpc.personTypes.list.useQuery(LIST_INPUT, {
      enabled: activeCatalog === 'personTypes',
    }),
    create: trpc.personTypes.create.useMutation(),
    update: trpc.personTypes.update.useMutation(),
    delete: trpc.personTypes.delete.useMutation(),
    invalidate: () => utils.personTypes.list.invalidate(),
  };
  const regimeTypes = {
    query: trpc.regimeTypes.list.useQuery(LIST_INPUT, {
      enabled: activeCatalog === 'regimeTypes',
    }),
    create: trpc.regimeTypes.create.useMutation(),
    update: trpc.regimeTypes.update.useMutation(),
    delete: trpc.regimeTypes.delete.useMutation(),
    invalidate: () => utils.regimeTypes.list.invalidate(),
  };
  const clientTypes = {
    query: trpc.clientTypes.list.useQuery(LIST_INPUT, {
      enabled: activeCatalog === 'clientTypes',
    }),
    create: trpc.clientTypes.create.useMutation(),
    update: trpc.clientTypes.update.useMutation(),
    delete: trpc.clientTypes.delete.useMutation(),
    invalidate: () => utils.clientTypes.list.invalidate(),
  };
  const commercialActivities = {
    query: trpc.commercialActivities.list.useQuery(LIST_INPUT, {
      enabled: activeCatalog === 'commercialActivities',
    }),
    create: trpc.commercialActivities.create.useMutation(),
    update: trpc.commercialActivities.update.useMutation(),
    delete: trpc.commercialActivities.delete.useMutation(),
    invalidate: () => utils.commercialActivities.list.invalidate(),
  };

  const resource = {
    identificationTypes,
    personTypes,
    regimeTypes,
    clientTypes,
    commercialActivities,
  }[activeCatalog];

  const items: CustomerCatalogItem[] = (resource.query.data?.items ?? []).map(item => ({
    ...item,
    isActive: item.isActive ?? false,
  }));

  return { ...resource, items };
}
