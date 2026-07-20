/**
 * Tests del serializador XML CFDI 4.0.
 *
 * Verifican estructura Anexo 20 (atributos requeridos del root,
 * Emisor, Receptor, Conceptos, Impuestos), edge cases (consumidor
 * final, foreign buyer, currency rejection, decimales, idempotencia),
 * y que el output sea XML serializable + parseable.
 */
import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../services/fiscal/adapter.js';
import { prettyPrintCfdi, serializeCfdi40 } from '../services/fiscal/packs/mx/cfdi40-xml.js';
import type { MxFiscalSettings } from '../services/fiscal/packs/mx/settings.js';

// --------------------------------------------------------------
// Fixtures.
// --------------------------------------------------------------

const baseSettings: MxFiscalSettings = {
  enabled: true,
  rfc: 'AAA010101AAA',
  regimenFiscalCode: '601',
  lugarExpedicion: '06700',
  environment: 'sandbox',
};

const baseLine: FiscalAdapterLine = {
  lineNumber: 1,
  productName: 'Producto demo',
  productSku: 'SKU-001',
  unitMeasureCode: 'unit',
  quantity: 2,
  // POS prices are VAT-inclusive; serializer must emit tax-exclusive CFDI amounts.
  unitPrice: 58,
  discountAmount: 0,
  taxRate: 16,
  taxAmount: 16,
  taxCategoryCode: '01',
  lineTotal: 116,
};

function buildInput(overrides: Partial<FiscalAdapterIssueInput> = {}): FiscalAdapterIssueInput {
  return {
    tenantId: 'tenant-1',
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'DEE',
    issueDate: '2026-05-01',
    issueTime: '10:30:00Z',
    environment: '2',
    issuerNit: 'tenant-1',
    issuerName: 'Empresa Demo SA de CV',
    currencyCode: 'MXN',
    localeCode: 'es-MX',
    paymentMethod: 'cash',
    resolution: {
      id: 'resolution-1',
      resolutionNumber: 'R-001',
      prefix: 'F',
      technicalKey: 'tk',
      consecutive: 42,
      documentNumber: 'F0000000042',
    },
    buyer: {
      taxId: 'BBB020202BBB',
      taxIdTypeCode: 'NIT',
      name: 'Cliente Demo',
      email: 'cliente@demo.mx',
      address: 'Calle 123',
      city: '01000',
      department: 'CDMX',
      country: 'MX',
    },
    subtotal: 100,
    ivaAmount: 16,
    incAmount: 0,
    icaAmount: 0,
    discountAmount: 0,
    totalAmount: 116,
    lines: [baseLine],
    ...overrides,
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // CFDI usa namespace prefix; preservar.
  removeNSPrefix: false,
});

// --------------------------------------------------------------
// Tests.
// --------------------------------------------------------------

describe('serializeCfdi40 — root + namespaces', () => {
  it('genera prólogo XML UTF-8 + cfdi:Comprobante con namespaces correctos', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo SA');
    expect(result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(result.xml).toContain('xmlns:cfdi="http://www.sat.gob.mx/cfd/4"');
    expect(result.xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(result.xml).toContain('Version="4.0"');
  });

  it('genera UUID v4 válido (placeholder local hasta )', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo SA');
    expect(result.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('atributos requeridos del root presentes (Anexo 20)', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo SA');
    const parsed = parser.parse(result.xml);
    const comp = parsed['cfdi:Comprobante'];
    expect(comp['@_Version']).toBe('4.0');
    expect(comp['@_Serie']).toBe('F');
    expect(comp['@_Folio']).toBe('42');
    expect(comp['@_Fecha']).toBe('2026-05-01T10:30:00');
    expect(comp['@_Moneda']).toBe('MXN');
    expect(comp['@_TipoDeComprobante']).toBe('I');
    expect(comp['@_LugarExpedicion']).toBe('06700');
    expect(comp['@_Exportacion']).toBe('01');
    expect(comp['@_SubTotal']).toBe('100.00');
    expect(comp['@_Total']).toBe('116.00');
  });

  it('venta pagada en efectivo usa MetodoPago=PUE y FormaPago=01', () => {
    const result = serializeCfdi40(buildInput({ paymentMethod: 'cash' }), baseSettings, 'Demo SA');
    const comp = parser.parse(result.xml)['cfdi:Comprobante'];
    expect(comp['@_MetodoPago']).toBe('PUE');
    expect(comp['@_FormaPago']).toBe('01');
  });

  it('venta a crédito usa MetodoPago=PPD y FormaPago=99', () => {
    const result = serializeCfdi40(
      buildInput({ paymentMethod: 'credit' }),
      baseSettings,
      'Demo SA'
    );
    const comp = parser.parse(result.xml)['cfdi:Comprobante'];
    expect(comp['@_MetodoPago']).toBe('PPD');
    expect(comp['@_FormaPago']).toBe('99');
  });

  it('TipoDeComprobante=I para sale, =E para return o void', () => {
    const sale = serializeCfdi40(buildInput({ source: 'sale' }), baseSettings, 'Demo');
    expect(sale.tipoComprobante).toBe('I');

    const ret = serializeCfdi40(
      buildInput({
        source: 'return',
        kind: 'NC',
        originalCufe: 'original-uuid-aaa',
      }),
      baseSettings,
      'Demo'
    );
    expect(ret.tipoComprobante).toBe('E');

    const voided = serializeCfdi40(
      buildInput({
        source: 'void',
        kind: 'ND',
        originalCufe: 'original-uuid-bbb',
      }),
      baseSettings,
      'Demo'
    );
    expect(voided.tipoComprobante).toBe('E');
  });
});

describe('serializeCfdi40 — Emisor', () => {
  it('Rfc, Nombre, RegimenFiscal del emisor', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Empresa Demo SA');
    const parsed = parser.parse(result.xml);
    const emisor = parsed['cfdi:Comprobante']['cfdi:Emisor'];
    expect(emisor['@_Rfc']).toBe('AAA010101AAA');
    expect(emisor['@_Nombre']).toBe('Empresa Demo SA');
    expect(emisor['@_RegimenFiscal']).toBe('601');
  });

  it('Nombre del emisor cae al RFC cuando no se inyecta issuerName', () => {
    // serializer recibe emisorName directo; cuando el caller pasa
    // string vacío o el RFC, el resultado refleja eso.
    const result = serializeCfdi40(buildInput(), baseSettings, 'AAA010101AAA');
    const parsed = parser.parse(result.xml);
    expect(parsed['cfdi:Comprobante']['cfdi:Emisor']['@_Nombre']).toBe('AAA010101AAA');
  });
});

describe('serializeCfdi40 — Receptor', () => {
  it('cliente mexicano sin perfil fiscal dedicado cae a público general', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    const parsed = parser.parse(result.xml);
    const receptor = parsed['cfdi:Comprobante']['cfdi:Receptor'];
    expect(receptor['@_Rfc']).toBe('XAXX010101000');
    expect(receptor['@_Nombre']).toBe('PUBLICO EN GENERAL');
    expect(receptor['@_DomicilioFiscalReceptor']).toBe('06700');
    expect(receptor['@_UsoCFDI']).toBe('S01');
  });

  it('consumidor final → XAXX010101000 + Público en general', () => {
    const result = serializeCfdi40(
      buildInput({
        buyer: {
          taxId: '222222222222',
          taxIdTypeCode: '31',
          name: 'Consumidor final',
          email: null,
          address: null,
          city: null,
          department: null,
          country: null,
        },
      }),
      baseSettings,
      'Demo'
    );
    expect(result.receptorRfc).toBe('XAXX010101000');
    const parsed = parser.parse(result.xml);
    const receptor = parsed['cfdi:Comprobante']['cfdi:Receptor'];
    expect(receptor['@_Rfc']).toBe('XAXX010101000');
    expect(receptor['@_Nombre']).toBe('PUBLICO EN GENERAL');
    expect(receptor['@_DomicilioFiscalReceptor']).toBe('06700');
    expect(receptor['@_UsoCFDI']).toBe('S01');
  });

  it('foreign buyer → XEXX010101000 + ResidenciaFiscal', () => {
    const result = serializeCfdi40(
      buildInput({
        buyer: {
          taxId: '999888777',
          taxIdTypeCode: 'PA',
          name: 'Foreign Customer',
          email: null,
          address: null,
          city: '90210',
          department: 'CA',
          country: 'US',
        },
      }),
      baseSettings,
      'Demo'
    );
    expect(result.receptorRfc).toBe('XEXX010101000');
    const parsed = parser.parse(result.xml);
    const receptor = parsed['cfdi:Comprobante']['cfdi:Receptor'];
    expect(receptor['@_Rfc']).toBe('XEXX010101000');
    expect(receptor['@_ResidenciaFiscal']).toBe('USA');
    expect(receptor['@_NumRegIdTrib']).toBe('999888777');
  });

  it('normaliza nombres de país comunes a clave SAT alpha-3', () => {
    const result = serializeCfdi40(
      buildInput({
        buyer: {
          taxId: '1000112179',
          taxIdTypeCode: 'PA',
          name: 'Ana Gómez',
          email: 'ana@example.co',
          address: 'Calle 1',
          city: 'Bogotá',
          department: null,
          country: 'Colombia',
        },
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const receptor = parsed['cfdi:Comprobante']['cfdi:Receptor'];
    expect(receptor['@_ResidenciaFiscal']).toBe('COL');
  });
});

describe('serializeCfdi40 — Conceptos', () => {
  it('cada line del input genera un cfdi:Concepto', () => {
    const result = serializeCfdi40(
      buildInput({
        lines: [
          { ...baseLine, lineNumber: 1, productName: 'Pan blanco', taxAmount: 16 },
          {
            ...baseLine,
            lineNumber: 2,
            productName: 'Leche entera',
            unitMeasureCode: 'lt',
            quantity: 3,
            unitPrice: 29,
            taxAmount: 12,
          },
        ],
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const conceptos = parsed['cfdi:Comprobante']['cfdi:Conceptos']['cfdi:Concepto'];
    // fast-xml-parser parsea single-element como objeto; array
    // cuando hay 2+. Forzamos array para iterar.
    const list = Array.isArray(conceptos) ? conceptos : [conceptos];
    expect(list).toHaveLength(2);
    expect(list[0]['@_Descripcion']).toBe('Pan blanco');
    expect(list[0]['@_ClaveProdServ']).toBe('50171831'); // panaderia
    expect(list[1]['@_Descripcion']).toBe('Leche entera');
    expect(list[1]['@_ClaveUnidad']).toBe('LTR');
  });

  it('Cantidad usa 6 decimales y ValorUnitario usa 6 decimales', () => {
    const result = serializeCfdi40(
      buildInput({
        lines: [
          {
            ...baseLine,
            quantity: 1.5,
            unitPrice: 99.999,
            taxRate: 0,
            taxAmount: 0,
          },
        ],
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const concepto = parsed['cfdi:Comprobante']['cfdi:Conceptos']['cfdi:Concepto'];
    expect(concepto['@_Cantidad']).toBe('1.500000');
    expect(concepto['@_ValorUnitario']).toBe('99.999000');
  });

  it('NoIdentificacion (sku) presente cuando productSku no es null', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    const parsed = parser.parse(result.xml);
    const concepto = parsed['cfdi:Comprobante']['cfdi:Conceptos']['cfdi:Concepto'];
    expect(concepto['@_NoIdentificacion']).toBe('SKU-001');
  });

  it('convierte precios POS con IVA incluido a importes CFDI sin IVA', () => {
    const result = serializeCfdi40(
      buildInput({
        subtotal: 86.21,
        ivaAmount: 13.79,
        totalAmount: 100,
        lines: [
          {
            ...baseLine,
            quantity: 1,
            unitPrice: 100,
            taxRate: 16,
            taxAmount: 13.79,
            lineTotal: 100,
          },
        ],
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const concepto = parsed['cfdi:Comprobante']['cfdi:Conceptos']['cfdi:Concepto'];
    const traslado = concepto['cfdi:Impuestos']['cfdi:Traslados']['cfdi:Traslado'];
    expect(concepto['@_ValorUnitario']).toBe('86.206897');
    expect(concepto['@_Importe']).toBe('86.21');
    expect(traslado['@_Base']).toBe('86.21');
  });

  it('ObjetoImp=02 cuando taxRate>0; ObjetoImp=01 cuando taxRate=0', () => {
    const gravado = serializeCfdi40(
      buildInput({ lines: [{ ...baseLine, taxRate: 16 }] }),
      baseSettings,
      'Demo'
    );
    const exento = serializeCfdi40(
      buildInput({
        lines: [{ ...baseLine, taxRate: 0, taxAmount: 0 }],
        ivaAmount: 0,
        totalAmount: 100,
      }),
      baseSettings,
      'Demo'
    );
    const gravadoConcepto = parser.parse(gravado.xml)['cfdi:Comprobante']['cfdi:Conceptos'][
      'cfdi:Concepto'
    ];
    const exentoConcepto = parser.parse(exento.xml)['cfdi:Comprobante']['cfdi:Conceptos'][
      'cfdi:Concepto'
    ];
    expect(gravadoConcepto['@_ObjetoImp']).toBe('02');
    expect(exentoConcepto['@_ObjetoImp']).toBe('01');
  });
});

describe('serializeCfdi40 — Impuestos agregados', () => {
  it('TotalImpuestosTrasladados = suma de taxAmount de las lines', () => {
    const result = serializeCfdi40(
      buildInput({
        lines: [
          { ...baseLine, lineNumber: 1, taxAmount: 16, taxRate: 16 },
          {
            ...baseLine,
            lineNumber: 2,
            productName: 'Producto B',
            taxAmount: 8,
            taxRate: 16,
            unitPrice: 29,
            quantity: 2,
          },
        ],
        ivaAmount: 24,
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const impuestos = parsed['cfdi:Comprobante']['cfdi:Impuestos'];
    expect(impuestos['@_TotalImpuestosTrasladados']).toBe('24.00');
  });

  it('todas las lines exentas → no se emite cfdi:Impuestos agregado', () => {
    const result = serializeCfdi40(
      buildInput({
        lines: [
          {
            ...baseLine,
            lineNumber: 1,
            productName: 'Pan',
            taxRate: 0,
            taxAmount: 0,
          },
        ],
        ivaAmount: 0,
        totalAmount: 100,
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const comp = parsed['cfdi:Comprobante'];
    expect(comp['cfdi:Impuestos']).toBeUndefined();
  });
});

describe('serializeCfdi40 — CfdiRelacionados', () => {
  it('source=return + originalCufe → cfdi:CfdiRelacionados con TipoRelacion 01', () => {
    const result = serializeCfdi40(
      buildInput({
        source: 'return',
        kind: 'NC',
        originalCufe: 'original-uuid-xyz',
      }),
      baseSettings,
      'Demo'
    );
    const parsed = parser.parse(result.xml);
    const rel = parsed['cfdi:Comprobante']['cfdi:CfdiRelacionados'];
    expect(rel['@_TipoRelacion']).toBe('01');
    expect(rel['cfdi:CfdiRelacionado']['@_UUID']).toBe('original-uuid-xyz');
  });

  it('sale sin originalCufe → no emite CfdiRelacionados', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    const parsed = parser.parse(result.xml);
    expect(parsed['cfdi:Comprobante']['cfdi:CfdiRelacionados']).toBeUndefined();
  });
});

describe('serializeCfdi40 — validaciones', () => {
  it('lines vacío → throw', () => {
    expect(() => serializeCfdi40(buildInput({ lines: [] }), baseSettings, 'Demo')).toThrow(
      /al menos un concepto/
    );
  });

  it('currencyCode != MXN → throw con guía hacia ', () => {
    expect(() =>
      serializeCfdi40(buildInput({ currencyCode: 'USD' }), baseSettings, 'Demo')
    ).toThrow(/MXN/);
  });

  it('settings sin RFC → throw', () => {
    expect(() => serializeCfdi40(buildInput(), { ...baseSettings, rfc: null }, 'Demo')).toThrow(
      /RFC del emisor/
    );
  });

  it('settings con regimenFiscal inválido → throw', () => {
    expect(() =>
      serializeCfdi40(buildInput(), { ...baseSettings, regimenFiscalCode: '999' }, 'Demo')
    ).toThrow(/no existe en el catálogo SAT/);
  });
});

describe('serializeCfdi40 — idempotencia + parseable', () => {
  it('output es XML parseable por fast-xml-parser', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    expect(() => parser.parse(result.xml)).not.toThrow();
  });

  it('mismo input produce el mismo XML excepto por el UUID', () => {
    const a = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    const b = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    // Los UUIDs son distintos por ser random.
    expect(a.uuid).not.toBe(b.uuid);
    // Pero el resto del XML (sin contar el UUID, que en
    // todavía no se inyecta dentro del XML — sólo se retorna como
    // metadata) debe ser idéntico.
    expect(a.xml).toBe(b.xml);
  });
});

describe('prettyPrintCfdi', () => {
  it('agrega saltos de línea + indentación al XML', () => {
    const result = serializeCfdi40(buildInput(), baseSettings, 'Demo');
    const pretty = prettyPrintCfdi(result.xml);
    expect(pretty).toContain('\n');
    expect(pretty).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(pretty).toContain('<cfdi:Comprobante');
    expect(pretty).toContain('<cfdi:Emisor');
  });
});
