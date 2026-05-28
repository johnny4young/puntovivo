import type { Product } from '@/types';

export interface ProviderAssignmentValue {
  providerId: string;
}

// ENG-179b — explicit `| undefined` on optional fields.
interface NormalizeProductProvidersInput {
  providerId?: string | null | undefined;
  providerAssignments?: ProviderAssignmentValue[] | null | undefined;
}

export interface NormalizedProductProviders {
  primaryProviderId: string | null;
  providerAssignments: ProviderAssignmentValue[];
}

export function normalizeProductProviders({
  providerId,
  providerAssignments,
}: NormalizeProductProvidersInput): NormalizedProductProviders {
  const providerIds = [
    ...(providerId ? [providerId] : []),
    ...(providerAssignments ?? []).map(assignment => assignment.providerId).filter(Boolean),
  ];
  const uniqueProviderIds = [...new Set(providerIds)];

  return {
    primaryProviderId: uniqueProviderIds[0] ?? null,
    providerAssignments: uniqueProviderIds.map(candidateId => ({ providerId: candidateId })),
  };
}

export function normalizeProductProviderSelections(product: Product | null): NormalizedProductProviders {
  if (!product) {
    return {
      primaryProviderId: null,
      providerAssignments: [],
    };
  }

  return normalizeProductProviders({
    providerId: product.providerId,
    providerAssignments: product.providerAssignments ?? [],
  });
}
