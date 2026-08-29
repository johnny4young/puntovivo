import { describe, expect, it } from 'vitest';

import {
  autoMapProductHeaders,
  hasRequiredProductMapping,
  mapProductImportRows,
} from './productImportMapping';
import { productExportColumns } from '@/features/products/productExport';

describe(' product import mapping', () => {
  it('auto-maps neutral English and accented Spanish aliases', () => {
    const mapping = autoMapProductHeaders([
      'Nombre',
      'Código interno',
      'Código de barras',
      'Precio venta',
      'Costo',
      'Stock inicial',
      'IVA',
      'Maneja inventario',
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
      tracksStock: 'Maneja inventario',
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
        'Tracks inventory',
        'Track lots and expiry',
      ])
    ).toMatchObject({
      name: 'Product name',
      sku: 'SKU',
      price: 'Sale price',
      stock: 'Opening stock',
      minStock: 'Minimum stock',
      taxRate: 'Tax rate',
      tracksStock: 'Tracks inventory',
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
        'Maneja inventario',
        'Controlar lotes y vencimientos',
      ])
    ).toMatchObject({
      name: 'Nombre del producto',
      sku: 'SKU',
      price: 'Precio de venta',
      stock: 'Stock de apertura',
      minStock: 'Stock mínimo',
      taxRate: 'Tasa de impuesto',
      tracksStock: 'Maneja inventario',
      tracksLots: 'Controlar lotes y vencimientos',
    });
  });

  it('maps the stock-tracking column emitted by product catalog exports', () => {
    const nameColumn = productExportColumns.find(column => column.key === 'name');
    const skuColumn = productExportColumns.find(column => column.key === 'sku');
    const tracksStockColumn = productExportColumns.find(column => column.key === 'tracksStock');
    expect(nameColumn && skuColumn && tracksStockColumn).toBeTruthy();

    const service = { name: 'Installation', sku: 'SVC-1', tracksStock: false };
    const file = {
      sourceName: 'products.csv',
      headers: [nameColumn!.header, skuColumn!.header, tracksStockColumn!.header],
      rows: [
        {
          rowNumber: 2,
          values: {
            [nameColumn!.header]: service.name,
            [skuColumn!.header]: service.sku,
            [tracksStockColumn!.header]: tracksStockColumn!.formatter!(
              service.tracksStock,
              service as never
            ),
          },
        },
      ],
    };
    const mapping = autoMapProductHeaders(file.headers);

    expect(mapping.tracksStock).toBe(tracksStockColumn!.header);
    expect(mapProductImportRows(file, mapping)[0]?.values.tracksStock).toBe('No');
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
