import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseImportFile } from './fileParser';
import { mapProductImportRows } from './productImportMapping';
import {
  buildProductImportProfileMapping,
  detectProductImportProfile,
  type ProductImportProfileId,
} from './productImportProfiles';

const CASES: Array<{
  fixture: string;
  profileId: ProductImportProfileId;
  expected: Record<string, string>;
}> = [
  {
    fixture: 'loyverse-items-en-v1.csv',
    profileId: 'loyverse-items-en-v1',
    expected: {
      name: 'Coffee beans',
      sku: 'LOY-001',
      barcode: '7701234000001',
      price: '25000',
      cost: '16000',
      stock: '18',
      minStock: '4',
      tracksStock: 'Y',
    },
  },
  {
    fixture: 'alegra-inventory-es-v1.csv',
    profileId: 'alegra-inventory-es-v1',
    expected: {
      name: 'Café molido',
      sku: 'ALG-001',
      description: 'Café de prueba',
      barcode: '7701234000002',
      unit: 'UND',
      price: '18000',
      cost: '11000',
      stock: '12',
      minStock: '3',
      taxName: 'IVA 19%',
      taxRate: '19',
    },
  },
  {
    fixture: 'siigo-products-es-v1.csv',
    profileId: 'siigo-products-es-v1',
    expected: {
      name: 'Chocolate',
      sku: 'SII-001',
      description: 'Cacao de prueba',
      barcode: '7701234000003',
      unit: 'UND',
      price: '9500',
      cost: '5800',
      stock: '20',
      minStock: '5',
      taxName: 'IVA 19%',
      taxRate: '19',
    },
  },
  {
    fixture: 'world-office-inventory-es-v1.csv',
    profileId: 'world-office-inventory-es-v1',
    expected: {
      name: 'Azúcar a granel',
      sku: 'WOF-001',
      barcode: '7701234000004',
      unit: 'KG',
      price: '5200',
      cost: '3600',
      stock: '30',
      minStock: '6',
      taxRate: '19',
    },
  },
];

function fixtureFile(name: string): File {
  const contents = readFileSync(
    resolve(process.cwd(), 'src/features/data-import/fixtures', name),
    'utf8'
  );
  return new File([contents], name, { type: 'text/csv' });
}

describe('product import source profiles', () => {
  it.each(CASES)('detects and maps the tested $fixture shape', async testCase => {
    const parsed = await parseImportFile(fixtureFile(testCase.fixture));
    expect(detectProductImportProfile(parsed.headers)).toBe(testCase.profileId);

    const mapping = buildProductImportProfileMapping(parsed.headers, testCase.profileId);
    expect(mapProductImportRows(parsed, mapping)[0]?.values).toMatchObject(testCase.expected);
  });

  it('fails closed when a known export changes a signature header', async () => {
    const parsed = await parseImportFile(fixtureFile('loyverse-items-en-v1.csv'));
    const changedHeaders = parsed.headers.map(header => (header === 'Name' ? 'Item name' : header));

    expect(detectProductImportProfile(changedHeaders)).toBe('generic');
    expect(buildProductImportProfileMapping(changedHeaders, 'generic').name).toBe('');
  });

  it('fails closed when one file matches more than one vendor signature', async () => {
    const loyverse = await parseImportFile(fixtureFile('loyverse-items-en-v1.csv'));
    const siigo = await parseImportFile(fixtureFile('siigo-products-es-v1.csv'));

    expect(detectProductImportProfile([...loyverse.headers, ...siigo.headers])).toBe('generic');
  });

  it('allows an explicit override while mapping only headers that are still present', async () => {
    const parsed = await parseImportFile(fixtureFile('loyverse-items-en-v1.csv'));
    const changedHeaders = parsed.headers.filter(header => header !== 'Handle');

    expect(detectProductImportProfile(changedHeaders)).toBe('generic');
    expect(buildProductImportProfileMapping(changedHeaders, 'loyverse-items-en-v1')).toMatchObject({
      name: 'Name',
      sku: 'SKU',
      price: 'Price',
    });
  });
});
