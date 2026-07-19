import { describe, expect, it } from 'vitest';

import type { ParsedImportFile } from './fileParser';
import {
  autoMapPartyHeaders,
  hasRequiredPartyMapping,
  mapPartyImportRows,
} from './partyImportMapping';

describe('ENG-123b party import mapping', () => {
  it('maps neutral Spanish customer headers and keeps only selected columns', () => {
    const file: ParsedImportFile = {
      sourceName: 'clientes.csv',
      headers: ['Nombre del cliente', 'NIT', 'Correo electrónico', 'Municipio', 'Ignorar'],
      rows: [
        {
          rowNumber: 2,
          values: {
            'Nombre del cliente': 'Café Uno',
            NIT: '9001',
            'Correo electrónico': 'hola@example.com',
            Municipio: 'Bogotá',
            Ignorar: 'x',
          },
        },
      ],
    };
    const mapping = autoMapPartyHeaders('customers', file.headers);
    expect(mapping).toMatchObject({
      name: 'Nombre del cliente',
      taxId: 'NIT',
      email: 'Correo electrónico',
      city: 'Municipio',
    });
    expect(hasRequiredPartyMapping(mapping)).toBe(true);
    expect(mapPartyImportRows('customers', file, mapping)).toEqual([
      {
        rowNumber: 2,
        values: {
          name: 'Café Uno',
          taxId: '9001',
          email: 'hola@example.com',
          city: 'Bogotá',
        },
      },
    ]);
  });

  it('maps supplier aliases and requires a name column', () => {
    const mapping = autoMapPartyHeaders('providers', [
      'Supplier name',
      'Contact name',
      'City code',
    ]);
    expect(mapping).toMatchObject({
      name: 'Supplier name',
      contactName: 'Contact name',
      cityCode: 'City code',
    });
    expect(hasRequiredPartyMapping(mapping)).toBe(true);
    expect(hasRequiredPartyMapping({ cityCode: 'City code' })).toBe(false);
  });

  it.each([
    [
      'English',
      [
        'Name',
        'Tax ID',
        'Email',
        'Phone',
        'Address',
        'City',
        'State or department',
        'Postal code',
        'Country',
        'Notes',
      ],
    ],
    [
      'Spanish',
      [
        'Nombre',
        'Identificación tributaria',
        'Correo electrónico',
        'Teléfono',
        'Dirección',
        'Ciudad',
        'Departamento o estado',
        'Código postal',
        'País',
        'Notas',
      ],
    ],
  ])('round-trips every %s customer template header through auto-mapping', (_, headers) => {
    expect(autoMapPartyHeaders('customers', headers)).toEqual({
      name: headers[0],
      taxId: headers[1],
      email: headers[2],
      phone: headers[3],
      address: headers[4],
      city: headers[5],
      state: headers[6],
      postalCode: headers[7],
      country: headers[8],
      notes: headers[9],
    });
  });

  it('round-trips every Spanish supplier template header through auto-mapping', () => {
    expect(
      autoMapPartyHeaders('providers', [
        'Nombre',
        'Identificación tributaria',
        'Correo electrónico',
        'Teléfono',
        'Dirección',
        'Nombre de contacto',
        'Código de ciudad',
      ])
    ).toEqual({
      name: 'Nombre',
      taxId: 'Identificación tributaria',
      email: 'Correo electrónico',
      phone: 'Teléfono',
      address: 'Dirección',
      contactName: 'Nombre de contacto',
      cityCode: 'Código de ciudad',
    });
  });
});
