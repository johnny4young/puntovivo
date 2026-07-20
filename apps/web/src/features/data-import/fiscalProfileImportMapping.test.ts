import { describe, expect, it } from 'vitest';

import type { ParsedImportFile } from './fileParser';
import {
  autoMapFiscalProfileHeaders,
  FISCAL_PROFILE_IMPORT_TEMPLATE,
  hasRequiredFiscalProfileMapping,
  mapFiscalProfileImportRows,
} from './fiscalProfileImportMapping';

describe(' fiscal profile import mapping', () => {
  it('maps accent-insensitive CO headers and keeps only selected columns', () => {
    const headers = [
      'Código de país',
      'NIT',
      'Resolución de numeración',
      'Prefijo',
      'Consecutivo inicial',
      'Consecutivo final',
      'Ambiente fiscal',
      'Ignorar',
    ];
    const mapping = autoMapFiscalProfileHeaders(headers);
    expect(mapping).toMatchObject({
      countryCode: 'Código de país',
      taxIdentifier: 'NIT',
      resolutionNumber: 'Resolución de numeración',
      numberingPrefix: 'Prefijo',
      rangeFrom: 'Consecutivo inicial',
      rangeTo: 'Consecutivo final',
      environment: 'Ambiente fiscal',
    });
    expect(hasRequiredFiscalProfileMapping(mapping)).toBe(true);

    const file: ParsedImportFile = {
      sourceName: 'fiscal.csv',
      headers,
      rows: [
        {
          rowNumber: 2,
          values: {
            'Código de país': 'CO',
            NIT: '900123456-7',
            'Resolución de numeración': '18764000001234',
            Prefijo: 'SETT',
            'Consecutivo inicial': '1',
            'Consecutivo final': '5000',
            'Ambiente fiscal': 'habilitacion',
            Ignorar: 'secret',
          },
        },
      ],
    };
    expect(mapFiscalProfileImportRows(file, mapping)).toEqual([
      {
        rowNumber: 2,
        values: {
          countryCode: 'CO',
          taxIdentifier: '900123456-7',
          resolutionNumber: '18764000001234',
          numberingPrefix: 'SETT',
          rangeFrom: '1',
          rangeTo: '5000',
          environment: 'habilitacion',
        },
      },
    ]);
  });

  it('requires country and issuer identity mappings', () => {
    const mapping = autoMapFiscalProfileHeaders(['Country code', 'Environment']);
    expect(mapping.countryCode).toBe('Country code');
    expect(mapping.taxIdentifier).toBe('');
    expect(hasRequiredFiscalProfileMapping(mapping)).toBe(false);
  });

  it('recognizes the localized field labels emitted by its own template', () => {
    expect(
      autoMapFiscalProfileHeaders(['Regime or activity code', 'Código de régimen o actividad'])
        .economicActivityCode
    ).toBe('Regime or activity code');
  });

  it('keeps country-specific optional cells empty in the canonical CO template', () => {
    expect(FISCAL_PROFILE_IMPORT_TEMPLATE).toMatchObject({
      countryCode: 'CO',
      taxIdentifier: '900123456-7',
      economicActivityCode: '',
      issueLocation: '',
      administrativeAreaCode: '',
      resolutionNumber: '18764000001234',
      environment: 'habilitacion',
    });
  });
});
