import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { ProductImportPreviewPanel } from './ProductImportPreview';
import type { ProductImportPreview } from './types';

const normalized = {
  name: 'Item',
  sku: 'SKU',
  description: null,
  barcode: null,
  unit: null,
  unitId: null,
  price: 1400,
  price2: 1300,
  price3: 1250,
  cost: 1000,
  stock: 0,
  minStock: 0,
  taxName: null,
  taxRate: 0,
  vatRateId: null,
  tracksStock: true,
  tracksLots: false,
};

const preview = {
  dataMode: 'real',
  previewHash: 'a'.repeat(64),
  summary: { total: 3, ready: 1, duplicates: 1, invalid: 1 },
  rows: [
    { rowNumber: 2, status: 'ready', normalized, issues: [] },
    {
      rowNumber: 3,
      status: 'duplicate',
      normalized,
      issues: [{ code: 'duplicate_file_sku', field: 'sku' }],
    },
    {
      rowNumber: 4,
      status: 'invalid',
      normalized,
      issues: [{ code: 'invalid_number', field: 'price2' }],
    },
  ],
} as ProductImportPreview;

describe('ProductImportPreviewPanel', () => {
  it('shows every price and filters to the rows with problems', async () => {
    render(
      <ProductImportPreviewPanel
        preview={preview}
        confirmedRealData={false}
        dataMode="real"
        importing={false}
        completed={false}
        onImport={vi.fn()}
        onDownloadIssues={vi.fn()}
        onConfirmRealData={vi.fn()}
      />
    );
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Price 3' })).toBeInTheDocument();
    expect(screen.getByTestId('data-import-preview-row-2')).toHaveTextContent('1250');

    await userEvent.click(screen.getByLabelText('Show only rows with problems (2)'));
    expect(screen.queryByTestId('data-import-preview-row-2')).toBeNull();
    expect(screen.getByTestId('data-import-preview-row-3')).toBeInTheDocument();
    expect(screen.getByTestId('data-import-preview-row-4')).toHaveTextContent(
      'Price 2: Number format is not valid'
    );
  });
});
