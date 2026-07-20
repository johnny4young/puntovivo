// Cell-value access + formatting helpers shared by every exporter
// ( slice 30). Internal: not part of the public barrel surface.

import type { ExportColumn } from './types';

/**
 * Get the value from an object using a dot-notation path
 */
export function getNestedValue(obj: object, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

/**
 * Format a value for export
 */
export function formatValue<T>(value: unknown, column: ExportColumn<T>, row: T): string {
  if (column.formatter) {
    return column.formatter(value, row);
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
