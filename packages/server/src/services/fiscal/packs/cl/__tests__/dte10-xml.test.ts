/**
 * Tests del serializador XML DTE 1.0.
 *
 * Verifican estructura SII (atributos + elementos requeridos del
 * Documento, Encabezado, Detalle, TED), edge cases (boleta consumidor
 * final, factura sin RUT, currency rejection, mixed afecto + exento,
 * referencia para nota crédito), y que el output sea XML serializable
 * + parseable.
 */
import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../../../adapter.js';
import type { ChileFolioAllocation } from '../caf-allocator.js';
import { prettyPrintDte, serializeDte10 } from '../dte10-xml.js';
import type { ClFiscalSettings } from '../settings.js';

// --------------------------------------------------------------
// Fixtures.
// --------------------------------------------------------------

const baseSettings: ClFiscalSettings = {
  enabled: true,
  rut: '76123456-0',
  giroCode: '4711',
  comunaCode: 13101,
  casaMatriz: 'Av. Principal 123, Santiago',
  environment: 'certificacion',
};

const baseLine: FiscalAdapterLine = {
  lineNumber: 1,
  productName: 'Producto demo',
  productSku: 'SKU-001',
  unitMeasureCode: 'unit',
  quantity: 2,
  // CLP afecto: precio neto 500 + IVA 19% (95) = total bruto 595 por unidad.
  // POS lineTotal incluye IVA: 2 × 595 = 1190; taxAmount 190 sobre subtotal 1000.
  unitPrice: 595,
  discountAmount: 0,
  taxRate: 19,
  taxAmount: 190,
  taxCategoryCode: '01',
  lineTotal: 1190,
};

const baseAllocation: ChileFolioAllocation = {
  cafId: 'caf-1',
  folio: 42,
  tipoDte: '39', // boleta default
  rutEmisor: '76123456-0',
  rawCafXml:
    '<AUTORIZACION><CAF version="1.0"><DA><RE>76123456-0</RE><RS>DEMO</RS><TD>39</TD><RNG><D>1</D><H>100</H></RNG><FA>2026-01-01</FA><RSAPK><M>fixture</M><E>Aw==</E></RSAPK><IDK>100</IDK></DA><FRMA algoritmo="SHA1withRSA">FIXTURE</FRMA></CAF></AUTORIZACION>',
  rangeRemaining: 58,
};

function buildInput(overrides: Partial<FiscalAdapterIssueInput> = {}): FiscalAdapterIssueInput {
  return {
    tenantId: 'tenant-1',
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'DEE',
    issueDate: '2026-05-07',
    issueTime: '10:30:00',
    environment: '2',
    issuerNit: 'tenant-1',
    issuerName: 'Empresa Demo SA',
    currencyCode: 'CLP',
    localeCode: 'es-CL',
    paymentMethod: 'cash',
    resolution: {
      id: 'resolution-1',
      resolutionNumber: 'R-001',
      prefix: 'B',
      technicalKey: 'tk',
      consecutive: 42,
      documentNumber: 'B0000000042',
    },
    buyer: {
      // El consumidor final SII se distingue por taxId ausente o
      // setteado al placeholder '222222222222' que el orchestrator
      // usa para CO. Boletas SII traducen ese caso a 66666666-6.
      taxId: '222222222222',
      taxIdTypeCode: 'NIT',
      name: 'CONSUMIDOR FINAL',
      email: null,
      address: null,
      city: null,
      department: null,
      country: 'CL',
    },
    subtotal: 1000,
    ivaAmount: 190,
    incAmount: 0,
    icaAmount: 0,
    discountAmount: 0,
    totalAmount: 1190,
    lines: [baseLine],
    ...overrides,
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
});

// --------------------------------------------------------------
// Tests.
// --------------------------------------------------------------

describe('serializeDte10 — root + namespace', () => {
  it('genera prólogo XML ISO-8859-1 + DTE root con namespace SII + version 1.0', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    expect(result.xml.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>')).toBe(true);
    expect(result.xml).toContain('xmlns="http://www.sii.cl/SiiDte"');
    expect(result.xml).toContain('version="1.0"');
  });

  it('Documento.@_ID = F<folio>T<tipoDte>', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    expect(parsed.DTE.Documento['@_ID']).toBe('F42T39');
  });
});

describe('serializeDte10 — boleta consumidor final (TipoDTE 39)', () => {
  it('emite Receptor con RUT genérico 66666666-6 cuando buyer es consumidor final', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    expect(parsed.DTE.Documento.Encabezado.Receptor.RUTRecep).toBe('66666666-6');
    expect(parsed.DTE.Documento.Encabezado.Receptor.RznSocRecep).toBe('CONSUMIDOR FINAL');
    expect(result.receptorRut).toBe('66666666-6');
  });

  it('IdDoc.TipoDTE / Folio / FchEmis bien poblados', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    expect(parsed.DTE.Documento.Encabezado.IdDoc.TipoDTE).toBe(39);
    expect(parsed.DTE.Documento.Encabezado.IdDoc.Folio).toBe(42);
    expect(parsed.DTE.Documento.Encabezado.IdDoc.FchEmis).toBe('2026-05-07');
    expect(parsed.DTE.Documento.Encabezado.IdDoc.FmaPago).toBe(1); // cash → contado
  });

  it('Emisor con todos los datos del settings CL', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    expect(parsed.DTE.Documento.Encabezado.Emisor.RUTEmisor).toBe('76123456-0');
    expect(parsed.DTE.Documento.Encabezado.Emisor.RznSoc).toBe('Empresa Demo SA');
    // fast-xml-parser auto-coerces numeric strings; assert string-equal.
    expect(String(parsed.DTE.Documento.Encabezado.Emisor.GiroEmis)).toBe('4711');
    expect(parsed.DTE.Documento.Encabezado.Emisor.CmnaOrigen).toBe(13101);
  });
});

describe('serializeDte10 — factura con RUT receptor (TipoDTE 33)', () => {
  it('emite Receptor con RUT real cuando buyer está identificado', () => {
    const allocation33: ChileFolioAllocation = {
      ...baseAllocation,
      tipoDte: '33',
      folio: 7,
    };
    const result = serializeDte10(
      buildInput({
        buyer: {
          taxId: '11111111-1',
          taxIdTypeCode: 'RUT',
          name: 'Cliente Razon Social SpA',
          email: null,
          address: null,
          city: null,
          department: null,
          country: 'CL',
        },
      }),
      baseSettings,
      'Empresa Demo SA',
      allocation33
    );
    const parsed = parser.parse(result.xml);
    expect(parsed.DTE.Documento.Encabezado.Receptor.RUTRecep).toBe('11111111-1');
    expect(parsed.DTE.Documento.Encabezado.Receptor.RznSocRecep).toBe('Cliente Razon Social SpA');
    expect(result.tipoDte).toBe('33');
  });

  it('rechaza factura sin RUT receptor (consumidor final no es válido para 33)', () => {
    const allocation33Bad: ChileFolioAllocation = {
      ...baseAllocation,
      tipoDte: '33',
    };
    expect(() =>
      serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', allocation33Bad)
    ).toThrow(/no coincide con expected/);
  });
});

describe('serializeDte10 — Totales aritmética', () => {
  it('una línea afecta única → MntNeto + IVA + MntTotal coherentes', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    const totales = parsed.DTE.Documento.Encabezado.Totales;
    expect(totales.MntNeto).toBe(1000);
    expect(totales.IVA).toBe(190);
    expect(totales.TasaIVA).toBe(19);
    expect(totales.MntTotal).toBe(1190);
    expect(result.mntTotal).toBe(1190);
  });

  it('mezcla afecto + exento → MntExe + MntNeto + IVA separados', () => {
    const result = serializeDte10(
      buildInput({
        lines: [
          { ...baseLine },
          {
            ...baseLine,
            lineNumber: 2,
            productName: 'Producto exento',
            taxRate: 0,
            taxAmount: 0,
            unitPrice: 500,
            quantity: 1,
            lineTotal: 500,
          },
        ],
      }),
      baseSettings,
      'Empresa Demo SA',
      baseAllocation
    );
    const parsed = parser.parse(result.xml);
    const totales = parsed.DTE.Documento.Encabezado.Totales;
    expect(totales.MntNeto).toBe(1000);
    expect(totales.MntExe).toBe(500);
    expect(totales.IVA).toBe(190);
    expect(totales.MntTotal).toBe(1690);
  });
});

describe('serializeDte10 — Detalle items', () => {
  it('emite Detalle con NroLinDet + NmbItem + QtyItem + MontoItem', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    const detalle = parsed.DTE.Documento.Detalle;
    // Single item is parsed as object, multiple as array — handle both.
    const items = Array.isArray(detalle) ? detalle : [detalle];
    expect(items[0].NroLinDet).toBe(1);
    expect(items[0].NmbItem).toBe('Producto demo');
    expect(items[0].QtyItem).toBe(2);
    expect(items[0].UnmdItem).toBe('un');
    expect(items[0].MontoItem).toBe(1000);
  });

  it('marca IndExe=1 en líneas exentas', () => {
    const result = serializeDte10(
      buildInput({
        lines: [
          {
            ...baseLine,
            taxRate: 0,
            taxAmount: 0,
            lineTotal: 1000,
            unitPrice: 500,
          },
        ],
      }),
      baseSettings,
      'Empresa Demo SA',
      baseAllocation
    );
    const parsed = parser.parse(result.xml);
    const detalle = parsed.DTE.Documento.Detalle;
    const items = Array.isArray(detalle) ? detalle : [detalle];
    expect(items[0].IndExe).toBe(1);
  });
});

describe('serializeDte10 — TED placeholder estructura', () => {
  it('TED.DD lleva todos los campos requeridos por SII', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    const ted = parsed.DTE.Documento.TED;
    expect(ted['@_version']).toBe('1.0');
    const dd = ted.DD;
    expect(dd.RE).toBe('76123456-0');
    expect(dd.TD).toBe(39);
    expect(dd.F).toBe(42);
    expect(dd.FE).toBe('2026-05-07');
    expect(dd.RR).toBe('66666666-6');
    expect(dd.RSR).toBe('CONSUMIDOR FINAL');
    expect(dd.MNT).toBe(1190);
    expect(dd.IT1).toBe('Producto demo');
    expect(dd.TSTED).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('TED.DD.CAF embeds the raw <DA> block from the CAF XML', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    // The DA block is escaped inside DD/CAF text content; check the raw XML.
    expect(result.xml).toContain('&lt;DA&gt;');
    expect(result.xml).toContain('&lt;RE&gt;76123456-0&lt;/RE&gt;');
  });

  it('TED.FRMT placeholder con algoritmo declarado y sin firma ( lifts)', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const parsed = parser.parse(result.xml);
    const ted = parsed.DTE.Documento.TED;
    expect(ted.FRMT['@_algoritmo']).toBe('SHA1withRSA');
    // FRMT puede venir como string vacío o como objeto vacío del parser.
    const frmaContent = typeof ted.FRMT === 'object' ? (ted.FRMT['#text'] ?? '') : ted.FRMT;
    expect(String(frmaContent ?? '').trim()).toBe('');
  });
});

describe('serializeDte10 — Referencia (nota crédito)', () => {
  it('emite Referencia para source=void con CodRef=1 (anula)', () => {
    const allocationNc: ChileFolioAllocation = {
      ...baseAllocation,
      tipoDte: '61',
    };
    const result = serializeDte10(
      buildInput({
        source: 'void',
        originalCufe: 'sii-cl:76123456-0:39:1',
        reasonCode: 'ERROR_CAJA',
      }),
      baseSettings,
      'Empresa Demo SA',
      allocationNc
    );
    const parsed = parser.parse(result.xml);
    const ref = parsed.DTE.Documento.Referencia;
    expect(ref.NroLinRef).toBe(1);
    expect(String(ref.TpoDocRef)).toBe('39');
    expect(String(ref.FolioRef)).toBe('1');
    expect(ref.CodRef).toBe(1);
    expect(ref.RazonRef).toBe('ERROR_CAJA');
  });

  it('emite Referencia para source=return con CodRef=3 (corrige montos)', () => {
    const allocationNc: ChileFolioAllocation = {
      ...baseAllocation,
      tipoDte: '61',
    };
    const result = serializeDte10(
      buildInput({
        source: 'return',
        originalCufe: 'sii-cl:76123456-0:33:5',
        reasonCode: 'DEVOLUCION',
      }),
      baseSettings,
      'Empresa Demo SA',
      allocationNc
    );
    const parsed = parser.parse(result.xml);
    expect(parsed.DTE.Documento.Referencia.CodRef).toBe(3);
    expect(String(parsed.DTE.Documento.Referencia.TpoDocRef)).toBe('33');
    expect(String(parsed.DTE.Documento.Referencia.FolioRef)).toBe('5');
  });
});

describe('serializeDte10 — defensive validations', () => {
  it('rechaza currency != CLP', () => {
    expect(() =>
      serializeDte10(
        buildInput({ currencyCode: 'USD' }),
        baseSettings,
        'Empresa Demo SA',
        baseAllocation
      )
    ).toThrow(/CLP/);
  });

  it('rechaza lines vacío', () => {
    expect(() =>
      serializeDte10(buildInput({ lines: [] }), baseSettings, 'Empresa Demo SA', baseAllocation)
    ).toThrow(/al menos un Detalle/);
  });

  it('rechaza settings sin RUT', () => {
    expect(() =>
      serializeDte10(
        buildInput(),
        { ...baseSettings, rut: null },
        'Empresa Demo SA',
        baseAllocation
      )
    ).toThrow(/RUT del emisor/);
  });

  it('rechaza settings sin giroCode', () => {
    expect(() =>
      serializeDte10(
        buildInput(),
        { ...baseSettings, giroCode: null },
        'Empresa Demo SA',
        baseAllocation
      )
    ).toThrow(/giro comercial/);
  });
});

describe('prettyPrintDte', () => {
  it('indenta el XML serializado preservando la declaración', () => {
    const result = serializeDte10(buildInput(), baseSettings, 'Empresa Demo SA', baseAllocation);
    const pretty = prettyPrintDte(result.xml);
    expect(pretty.startsWith('<?xml version="1.0" encoding="ISO-8859-1"?>\n<DTE')).toBe(true);
    // Indentation preserved: nested Encabezado has leading whitespace.
    expect(pretty).toMatch(/\n\s+<Encabezado>/);
  });
});
