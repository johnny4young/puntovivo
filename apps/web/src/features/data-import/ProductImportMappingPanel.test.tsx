import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { ProductImportMappingPanel } from './ProductImportMappingPanel';
import { autoMapProductHeaders } from './productImportMapping';
import {
  buildProductImportProfileMapping,
  detectProductImportProfile,
} from './productImportProfiles';

function renderPanel(headers: string[]) {
  const detected = detectProductImportProfile(headers);
  return render(
    <ProductImportMappingPanel
      headers={headers}
      mapping={buildProductImportProfileMapping(headers, detected)}
      decimalFormat="auto"
      profileId={detected}
      detectedProfileId={detected}
      disabled={false}
      onMappingChange={vi.fn()}
      onDecimalFormatChange={vi.fn()}
      onProfileChange={vi.fn()}
    />
  );
}

const MONICA = ['Código', 'Nombre del producto', 'Costo', 'Precio 1', 'Precio 2', 'Precio 3'];

describe('ProductImportMappingPanel', () => {
  it('summarizes a recognized file and keeps the field selectors folded', async () => {
    renderPanel(MONICA);
    expect(screen.getByText('6 columns recognized')).toBeInTheDocument();
    expect(screen.getByText('Precio 2 → Price 2')).toBeInTheDocument();
    expect(screen.queryByTestId('data-import-mapping-warnings')).toBeNull();
    const fields = document.getElementById('data-import-mapping-fields');
    expect(fields).not.toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Review mapping' }));
    expect(fields).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide mapping' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('warns about columns that will not be imported and unknown formats', () => {
    renderPanel(['Nombre', 'SKU', 'Precio', 'Ubicación', 'Precio 4']);
    const warnings = screen.getByTestId('data-import-mapping-warnings');
    expect(warnings).toHaveTextContent('We did not recognize the file format');
    expect(warnings).toHaveTextContent(
      'These columns in your file will not be imported: Ubicación, Precio 4.'
    );
  });

  it('opens the selectors when a required column is missing', () => {
    expect(autoMapProductHeaders(['Producto', 'Valor']).sku).toBe('');
    renderPanel(['Producto', 'Valor']);
    expect(screen.getByTestId('data-import-mapping-warnings')).toHaveTextContent(
      'Map the product name and the SKU to continue.'
    );
    expect(document.getElementById('data-import-mapping-fields')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review mapping' })).toBeNull();
  });
});
