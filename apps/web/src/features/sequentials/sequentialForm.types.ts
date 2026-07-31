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

export function createSequentialFormValues(sequential: Sequential | null): SequentialFormValues {
  if (!sequential) return defaultValues;

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
