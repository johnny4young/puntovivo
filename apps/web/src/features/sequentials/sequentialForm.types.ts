import type { Sequential } from '@/types';

export interface SequentialFormValues {
  siteId: string;
  documentType: Sequential['documentType'];
  prefix: string;
  currentValue: number;
}

export interface SequentialFormSubmission {
  siteId: string;
  documentType: Sequential['documentType'];
  prefix: string;
  currentValue?: number;
}

const defaultValues: SequentialFormValues = {
  siteId: '',
  documentType: 'sale',
  prefix: '',
  currentValue: 0,
};

export function createSequentialFormValues(
  sequential: Sequential | null,
  sites: readonly { id: string }[] = []
): SequentialFormValues {
  if (!sequential) {
    return sites.length === 1 ? { ...defaultValues, siteId: sites[0]!.id } : defaultValues;
  }

  return {
    siteId: sequential.siteId,
    documentType: sequential.documentType,
    prefix: sequential.prefix,
    currentValue: sequential.currentValue,
  };
}

export function formatSequentialPreview(prefix: string, currentValue: number): string {
  const safeCurrentValue = Number.isFinite(currentValue) ? currentValue : 0;
  return `${prefix}${String(Math.max(0, Math.trunc(safeCurrentValue)) + 1).padStart(6, '0')}`;
}
