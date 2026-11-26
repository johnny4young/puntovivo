import { describe, expect, it } from 'vitest';
import {
  buildShelfLabelsPrintHtml,
  buildTsplLabels,
  buildZplLabels,
  encodeCode128BModules,
  encodeEan13Modules,
  isValidEan13,
  renderBarcodeSvg,
  shelfLabelPrice,
  type ShelfLabelProduct,
} from './shelfLabels';

const SAMPLE_PRODUCTS: ShelfLabelProduct[] = [
  {
    id: 'p1',
    name: 'Café Molido 500g',
    sku: 'CAF-500',
    barcode: '7701234567897',
    price: 18500,
    copies: 2,
  },
  {
    id: 'p2',
    name: 'Arroz Blanco 1kg',
    sku: 'ARR-001',
    barcode: null,
    price: 4200,
    copies: 1,
  },
];

describe('shelfLabels', () => {
  it('validates and encodes standard 13-digit EAN-13 into 95 modules', () => {
    expect(isValidEan13('7701234567897')).toBe(true);
    expect(isValidEan13('7701234567890')).toBe(false);
    const bits = encodeEan13Modules('7701234567897');
    expect(bits).not.toBeNull();
    expect(bits?.length).toBe(95);
    expect(bits?.startsWith('101')).toBe(true);
    expect(bits?.endsWith('101')).toBe(true);
  });

  it('renders EAN-13 SVG for valid EAN-13 and falls back to Code 128B for SKUs', () => {
    const ean = renderBarcodeSvg('7701234567897');
    expect(ean.symbology).toBe('ean13');
    expect(ean.svg).toContain('<svg');
    expect(ean.svg).toContain('7701234567897');

    const code128 = renderBarcodeSvg('ARR-001');
    expect(code128.symbology).toBe('code128');
    expect(code128.svg).toContain('<svg');
    expect(code128.svg).toContain('ARR-001');
    expect(encodeCode128BModules('ARR-001').bits.length).toBeGreaterThan(50);
  });

  it('builds Letter and A4 printable sheets honoring copies per product', () => {
    const html = buildShelfLabelsPrintHtml(SAMPLE_PRODUCTS, {
      paper: 'a4',
      grid: '3x8',
      formatPrice: price => `$${price.toLocaleString('es-CO')}`,
      title: 'Etiquetas de góndola',
    });
    expect(html).toContain('@page { size: A4 portrait;');
    expect(html).toContain('grid-template-columns: repeat(3, 1fr)');
    // 2 copies of p1 + 1 copy of p2 = 3 label cards
    expect(html.match(/class="label-card"/g)?.length).toBe(3);
  });

  it('builds valid Zebra ZPL II and TSC/Xprinter TSPL label scripts', () => {
    const zpl = buildZplLabels(SAMPLE_PRODUCTS, { formatPrice: p => `$${p}` });
    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^BEN,52,Y,N^FD770123456789^FS');
    expect(zpl).toContain('^BCN,52,Y,N,N^FDARR-001^FS');
    expect(zpl).toContain('^PQ2,0,1,Y');
    expect(zpl).toContain('^XZ');

    const tspl = buildTsplLabels(SAMPLE_PRODUCTS, { formatPrice: p => `$${p}` });
    expect(tspl).toContain('SIZE 50 mm, 30 mm');
    expect(tspl).toContain('"EAN13"');
    expect(tspl).toContain('"128"');
    expect(tspl).toContain('PRINT 1,2');
    expect(tspl).toContain('PRINT 1,1');
  });

  it('strips ZPL and TSPL control characters from Code 128 barcode values', () => {
    const unsafe: ShelfLabelProduct[] = [
      { id: 'p3', name: 'Promo', sku: 'AB^C~D"E', barcode: null, price: 1000, copies: 1 },
    ];
    const zpl = buildZplLabels(unsafe, { formatPrice: p => `$${p}` });
    expect(zpl).toContain('^BCN,52,Y,N,N^FDABCDE^FS');

    const tspl = buildTsplLabels(unsafe, { formatPrice: p => `$${p}` });
    const barcodeLine = tspl.split('\n').find(line => line.startsWith('BARCODE'));
    expect(barcodeLine).toContain('"ABCDE"');
  });

  it('prints the register price: tax added when catalog prices exclude it', () => {
    const product: ShelfLabelProduct = {
      id: 'p4',
      name: 'Aceite',
      sku: 'ACE-1',
      price: 10000,
      taxRate: 19,
    };
    expect(shelfLabelPrice(product, true)).toBe(10000);
    expect(shelfLabelPrice(product, false)).toBe(11900);
    expect(
      shelfLabelPrice({ ...product, taxComponents: [{ taxRate: 19 }, { taxRate: 8 }] }, false)
    ).toBe(12700);
  });
});
