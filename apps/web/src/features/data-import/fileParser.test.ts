import { describe, expect, it } from 'vitest';

import {
  decodeCsvBytes,
  ImportFileError,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  MAX_PRODUCT_IMPORT_ROWS,
  parseCsvText,
  parseImportFile,
} from './fileParser';

describe(' import file parser', () => {
  it('parses BOM, semicolon CSV, escaped quotes, CRLF, and skips empty rows', () => {
    const parsed = parseCsvText(
      '\uFEFFNombre;SKU;Precio\r\n"Café ""Origen""";CAF-1;12,50\r\n;;\r\nPan;PAN-1;4,20\r\n',
      'catalogo.csv'
    );
    expect(parsed).toEqual({
      sourceName: 'catalogo.csv',
      headers: ['Nombre', 'SKU', 'Precio'],
      rows: [
        {
          rowNumber: 2,
          values: { Nombre: 'Café "Origen"', SKU: 'CAF-1', Precio: '12,50' },
        },
        { rowNumber: 4, values: { Nombre: 'Pan', SKU: 'PAN-1', Precio: '4,20' } },
      ],
    });
  });

  it('reads Windows-1252 CSV exports when the bytes are not valid UTF-8', async () => {
    // "Código;Nombre\r\nA-1;Piña" encoded as Windows-1252.
    const bytes = new Uint8Array([
      0x43, 0xf3, 0x64, 0x69, 0x67, 0x6f, 0x3b, 0x4e, 0x6f, 0x6d, 0x62, 0x72, 0x65, 0x0d, 0x0a,
      0x41, 0x2d, 0x31, 0x3b, 0x50, 0x69, 0xf1, 0x61,
    ]);
    expect(decodeCsvBytes(bytes.buffer)).toBe('Código;Nombre\r\nA-1;Piña');
    expect(decodeCsvBytes(new TextEncoder().encode('Código;Piña').buffer)).toBe('Código;Piña');
    const parsed = await parseImportFile(new File([bytes], 'monica.csv', { type: 'text/csv' }));
    expect(parsed.rows[0]?.values).toEqual({ Código: 'A-1', Nombre: 'Piña' });
  });

  it('applies the default row limit unless the caller raises it', () => {
    const csv = (rows: number) =>
      [
        'name,sku',
        ...Array.from({ length: rows }, (_, index) => `Item ${index},SKU-${index}`),
      ].join('\n');
    expect(() => parseCsvText(csv(MAX_IMPORT_ROWS + 1))).toThrowError(
      expect.objectContaining<Partial<ImportFileError>>({ code: 'too_many_rows' })
    );
    expect(
      parseCsvText(csv(MAX_PRODUCT_IMPORT_ROWS), 'catalog.csv', {
        maxRows: MAX_PRODUCT_IMPORT_ROWS,
      }).rows
    ).toHaveLength(MAX_PRODUCT_IMPORT_ROWS);
    expect(() =>
      parseCsvText(csv(MAX_PRODUCT_IMPORT_ROWS + 1), 'catalog.csv', {
        maxRows: MAX_PRODUCT_IMPORT_ROWS,
      })
    ).toThrowError(expect.objectContaining<Partial<ImportFileError>>({ code: 'too_many_rows' }));
  });

  it('rejects malformed, duplicate-header, unsupported, and oversized files', async () => {
    expect(() => parseCsvText('name,name\nA,B')).toThrowError(
      expect.objectContaining<Partial<ImportFileError>>({ code: 'duplicate_header' })
    );
    expect(() => parseCsvText('Código,codigo\nA,B')).toThrowError(
      expect.objectContaining<Partial<ImportFileError>>({ code: 'duplicate_header' })
    );
    expect(() => parseCsvText('name,sku\n"unfinished,A')).toThrowError(
      expect.objectContaining<Partial<ImportFileError>>({ code: 'malformed_csv' })
    );
    expect(() => parseCsvText('name,sku\n"closed"tail,A')).toThrowError(
      expect.objectContaining<Partial<ImportFileError>>({ code: 'malformed_csv' })
    );
    expect(() => parseCsvText('name,sku\nA,B,unexpected')).toThrowError(
      expect.objectContaining<Partial<ImportFileError>>({ code: 'row_too_wide' })
    );
    await expect(parseImportFile(new File(['x'], 'catalog.txt'))).rejects.toMatchObject({
      code: 'unsupported_file',
    });
    const oversized = new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], 'catalog.csv');
    await expect(parseImportFile(oversized)).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('reads the first Excel worksheet and uses cached formula results without evaluation', async () => {
    const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['Nombre', 'SKU', 'Precio']);
    sheet.getRow(4).values = ['Chocolate', 'CHO-1', { formula: '10+5', result: 15 }];
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = await parseImportFile(
      new File([buffer as BlobPart], 'productos.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
    expect(parsed.headers).toEqual(['Nombre', 'SKU', 'Precio']);
    expect(parsed.rows[0]).toEqual({
      rowNumber: 4,
      values: { Nombre: 'Chocolate', SKU: 'CHO-1', Precio: '15' },
    });
  });

  it('rejects non-empty Excel cells beyond the supported column boundary', async () => {
    const { default: ExcelJS } = await import('exceljs/dist/exceljs.bare.min.js');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    sheet.addRow(['Nombre', 'SKU']);
    sheet.getCell('A2').value = 'Chocolate';
    sheet.getCell('B2').value = 'CHO-1';
    sheet.getCell('CV2').value = 'must not be silently discarded';
    const buffer = await workbook.xlsx.writeBuffer();

    await expect(
      parseImportFile(
        new File([buffer as BlobPart], 'productos.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
      )
    ).rejects.toMatchObject({ code: 'row_too_wide' });
  });
});
