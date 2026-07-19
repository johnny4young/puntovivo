import { describe, expect, it } from 'vitest';

import {
  autoMapProductHeaders,
  hasRequiredProductMapping,
  mapProductImportRows,
} from './productImportMapping';

describe('ENG-123a product import mapping', () => {
  it('auto-maps neutral English and accented Spanish aliases', () => {
    const mapping = autoMapProductHeaders([
      'Nombre',
      'Código interno',
      'Código de barras',
      'Precio venta',
      'Costo',
      'Stock inicial',
      'IVA',
      'Control de lotes',
    ]);
    expect(mapping).toMatchObject({
      name: 'Nombre',
      sku: 'Código interno',
      barcode: 'Código de barras',
      price: 'Precio venta',
      cost: 'Costo',
      stock: 'Stock inicial',
      taxRate: 'IVA',
      tracksLots: 'Control de lotes',
    });
    expect(hasRequiredProductMapping(mapping)).toBe(true);
  });

  it('auto-maps the localized headers emitted by the downloadable templates', () => {
    expect(
      autoMapProductHeaders([
        'Product name',
        'SKU',
        'Sale price',
        'Opening stock',
        'Minimum stock',
        'Tax rate',
        'Track lots and expiry',
      ])
    ).toMatchObject({
      name: 'Product name',
      sku: 'SKU',
      price: 'Sale price',
      stock: 'Opening stock',
      minStock: 'Minimum stock',
      taxRate: 'Tax rate',
      tracksLots: 'Track lots and expiry',
    });
    expect(
      autoMapProductHeaders([
        'Nombre del producto',
        'SKU',
        'Precio de venta',
        'Stock de apertura',
        'Stock mínimo',
        'Tasa de impuesto',
        'Controlar lotes y vencimientos',
      ])
    ).toMatchObject({
      name: 'Nombre del producto',
      sku: 'SKU',
      price: 'Precio de venta',
      stock: 'Stock de apertura',
      minStock: 'Stock mínimo',
      taxRate: 'Tasa de impuesto',
      tracksLots: 'Controlar lotes y vencimientos',
    });
  });

  it('maps only selected columns and preserves spreadsheet row numbers', () => {
    const file = {
      sourceName: 'products.csv',
      headers: ['Product', 'Reference', 'Ignored'],
      rows: [
        {
          rowNumber: 8,
          values: { Product: 'Coffee', Reference: 'COF-1', Ignored: 'secret' },
        },
      ],
    };
    const mapping = autoMapProductHeaders(file.headers);
    expect(mapProductImportRows(file, mapping)).toEqual([
      { rowNumber: 8, values: { name: 'Coffee', sku: 'COF-1' } },
    ]);
  });
});
