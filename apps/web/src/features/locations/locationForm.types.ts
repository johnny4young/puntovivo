import type { Location } from '@/types';

export interface LocationFormValues {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

const defaultValues: LocationFormValues = {
  code: '',
  name: '',
  description: '',
  isActive: true,
};

export function createLocationFormValues(location: Location | null): LocationFormValues {
  if (!location) return defaultValues;

  return {
    code: location.code,
    name: location.name,
    description: location.description ?? '',
    isActive: location.isActive,
  };
}
