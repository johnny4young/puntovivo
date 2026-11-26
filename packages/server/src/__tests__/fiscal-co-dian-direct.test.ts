import { createSign, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FiscalAdapterIssueInput } from '../services/fiscal/adapter.js';
import {
  buildDianSoapEnvelope,
  buildSingleFileZip,
  COLOMBIA_DIAN_DIRECT_PROVIDER_ID,
  ColombiaDianAdapter,
  DIAN_SIGNATURE_POLICY_ID,
  inspectX509Certificate,
  signDianUblXml,
  verifyDianXadesSignature,
} from '../services/fiscal/packs/co/index.js';
import { buildColombiaUbl21DraftXml } from '../services/fiscal/packs/co/ubl21-xml.js';
import { describeFiscalProvider } from '../services/fiscal/registry.js';

// Minimal pure-Node ASN.1 DER self-signed X.509 v3 cert builder so tests run on every OS without openssl CLI.
function derLen(len: number): Buffer {
  if (len < 128) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(value.length), value]);
}
function derInt(value: Buffer): Buffer {
  const padded = (value[0]! & 0x80) !== 0 ? Buffer.concat([Buffer.from([0x00]), value]) : value;
  return derTlv(0x02, padded);
}
function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const out = [parts[0]! * 40 + parts[1]!];
  for (let i = 2; i < parts.length; i += 1) {
    let v = parts[i]!;
    const stack: number[] = [v & 0x7f];
    v >>>= 7;
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(...stack);
  }
  return derTlv(0x06, Buffer.from(out));
}
function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const str =
    String(date.getUTCFullYear()).slice(-2) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return derTlv(0x17, Buffer.from(str, 'ascii'));
}
function createTestSelfSignedCert(args: { notBefore: Date; notAfter: Date; cn?: string }) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const sha256WithRsaAlg = derTlv(
    0x30,
    Buffer.concat([derOid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00])])
  );
  const cnVal = derTlv(0x0c, Buffer.from(args.cn ?? 'Puntovivo DIAN Test', 'utf8'));
  const rdn = derTlv(0x31, derTlv(0x30, Buffer.concat([derOid('2.5.4.3'), cnVal])));
  const nameSeq = derTlv(0x30, rdn);
  const validity = derTlv(
    0x30,
    Buffer.concat([derUtcTime(args.notBefore), derUtcTime(args.notAfter)])
  );
  const version = derTlv(0xa0, derInt(Buffer.from([0x02]))); // v3
  const serial = derInt(Buffer.from([0x01, 0x23, 0x45, 0x67]));
  const tbs = derTlv(
    0x30,
    Buffer.concat([version, serial, sha256WithRsaAlg, nameSeq, validity, nameSeq, spkiDer])
  );
  const signer = createSign('RSA-SHA256');
  signer.update(tbs);
  const sigBytes = signer.sign(privateKey);
  const sigBitString = derTlv(0x03, Buffer.concat([Buffer.from([0x00]), sigBytes]));
  const certDer = derTlv(0x30, Buffer.concat([tbs, sha256WithRsaAlg, sigBitString]));
  const certB64 = certDer
    .toString('base64')
    .match(/.{1,64}/g)!
    .join('\n');
  const certificatePem = `-----BEGIN CERTIFICATE-----\n${certB64}\n-----END CERTIFICATE-----\n`;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return { certificatePem, privateKeyPem };
}

const CO_SETTINGS = {
  fiscal: { co: { nit: '900.373.115-3', softwareId: 'sw-co-123', softwarePin: '12301' } },
};

function buildSampleInput(
  overrides: Partial<FiscalAdapterIssueInput> = {}
): FiscalAdapterIssueInput {
  return {
    tenantId: 'tenant-co-1',
    tenantSettings: CO_SETTINGS,
    source: 'sale',
    sourceId: 'sale-100',
    kind: 'FEV',
    issueDate: '2026-11-26',
    issueTime: '09:30:00-05:00',
    environment: '2',
    issuerNit: '900373115',
    issuerName: 'Comercializadora Andina S.A.S.',
    currencyCode: 'COP',
    localeCode: 'es-CO',
    resolution: {
      id: 'res-fev-1',
      resolutionNumber: '18764000001234',
      prefix: 'SETP',
      technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
      consecutive: 42,
      documentNumber: 'SETP990000042',
    },
    buyer: {
      taxId: '800123456',
      taxIdTypeCode: '31',
      name: 'Cliente Empresarial S.A.S.',
      email: 'facturacion@cliente.co',
      address: 'Cra 7 # 12-34',
      city: 'Bogotá',
      department: 'Cundinamarca',
      country: 'CO',
    },
    subtotal: 200,
    ivaAmount: 24,
    incAmount: 8,
    icaAmount: 0,
    discountAmount: 10,
    totalAmount: 222,
    lines: [
      {
        lineNumber: 1,
        productName: 'Café Especial 500g',
        productSku: 'CAF-500',
        unitMeasureCode: 'EA',
        quantity: 1,
        unitPrice: 100,
        discountAmount: 0,
        taxRate: 19,
        taxAmount: 19,
        taxCategoryCode: '01',
        taxComponents: [
          {
            componentKey: 'iva:19',
            taxKind: 'iva',
            taxRate: 19,
            taxableAmount: 100,
            taxAmount: 19,
            taxCategoryCode: '01',
            position: 0,
          },
        ],
        lineTotal: 119,
      },
      {
        lineNumber: 2,
        productName: 'Almuerzo Ejecutivo',
        productSku: 'ALM-01',
        unitMeasureCode: 'EA',
        quantity: 1,
        unitPrice: 100,
        discountAmount: 0,
        taxRate: 8,
        taxAmount: 13,
        taxCategoryCode: '04',
        taxComponents: [
          {
            componentKey: 'iva:5',
            taxKind: 'iva',
            taxRate: 5,
            taxableAmount: 100,
            taxAmount: 5,
            taxCategoryCode: '01',
            position: 0,
          },
          {
            componentKey: 'inc:8',
            taxKind: 'inc',
            taxRate: 8,
            taxableAmount: 100,
            taxAmount: 8,
            taxCategoryCode: '04',
            position: 1,
          },
        ],
        lineTotal: 113,
      },
    ],
    ...overrides,
  };
}

describe('Colombia UBL 2.1 structural invariants', () => {
  it('groups header TaxTotal by scheme (01 IVA / 04 INC) with per-rate TaxSubtotal and preserves PayableAmount identity', () => {
    const xml = buildColombiaUbl21DraftXml(buildSampleInput(), 'a'.repeat(96), { mode: 'dian' });

    expect(xml).toContain('<cbc:CustomizationID>10</cbc:CustomizationID>');
    expect(xml).toContain('<cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>');
    expect(xml).toContain('<sts:DianExtensions>');
    expect(xml).toContain('<sts:InvoiceAuthorization>18764000001234</sts:InvoiceAuthorization>');
    expect(xml).toContain('catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=');

    // Separate TaxTotal for 01 (IVA = 19 + 5 = 24.00) with two subtotals (5.00% and 19.00%)
    // and separate TaxTotal for 04 (INC = 8.00) with one subtotal (8.00%).
    expect(xml).toContain(
      '<cac:TaxTotal><cbc:TaxAmount currencyID="COP">24.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">5.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>5.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">19.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>'
    );
    expect(xml).toContain(
      '<cac:TaxTotal><cbc:TaxAmount currencyID="COP">8.00</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount currencyID="COP">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="COP">8.00</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>8.00</cbc:Percent><cac:TaxScheme><cbc:ID>04</cbc:ID><cbc:Name>INC</cbc:Name></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>'
    );

    // LegalMonetaryTotal arithmetic identity: TaxInclusiveAmount (232.00) - AllowanceTotalAmount (10.00) = PayableAmount (222.00).
    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="COP">232.00</cbc:TaxInclusiveAmount>'
    );
    expect(xml).toContain(
      '<cbc:AllowanceTotalAmount currencyID="COP">10.00</cbc:AllowanceTotalAmount>'
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="COP">222.00</cbc:PayableAmount>');

    // DIAN schemeAgencyID + schemeID (DV) + schemeName on Supplier and Buyer CompanyID.
    expect(xml).toContain('schemeID="3" schemeName="31">900373115</cbc:CompanyID>');
    expect(xml).toContain('schemeID="5" schemeName="31">800123456</cbc:CompanyID>');
  });

  it('does not double-subtract line-level discounts in LegalMonetaryTotal', () => {
    const input = buildSampleInput({
      subtotal: 90,
      ivaAmount: 17.1,
      incAmount: 0,
      discountAmount: 10,
      totalAmount: 107.1,
      lines: [
        {
          lineNumber: 1,
          productName: 'Producto con descuento',
          productSku: 'DSC-1',
          unitMeasureCode: 'EA',
          quantity: 1,
          unitPrice: 100,
          discountAmount: 10,
          taxRate: 19,
          taxAmount: 17.1,
          taxCategoryCode: '01',
          lineTotal: 107.1,
        },
      ],
    });
    const xml = buildColombiaUbl21DraftXml(input, 'b'.repeat(96), { mode: 'dian' });
    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="COP">107.10</cbc:TaxInclusiveAmount>'
    );
    expect(xml).toContain(
      '<cbc:AllowanceTotalAmount currencyID="COP">0.00</cbc:AllowanceTotalAmount>'
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="COP">107.10</cbc:PayableAmount>');
  });
});

describe('Colombia XAdES-EPES signer and verifier', () => {
  const validCreds = createTestSelfSignedCert({
    notBefore: new Date('2025-01-01T00:00:00Z'),
    notAfter: new Date('2030-01-01T00:00:00Z'),
  });

  it('signs a UBL 2.1 XML document with DIAN v2 policy and verifies cryptographically', () => {
    const xml = buildColombiaUbl21DraftXml(buildSampleInput(), 'c'.repeat(96), { mode: 'dian' });
    const signed = signDianUblXml({
      xml,
      certificatePem: validCreds.certificatePem,
      privateKeyPem: validCreds.privateKeyPem,
      signingTimeIso: '2026-11-26T14:30:00.000Z',
    });

    expect(signed.signedXml).toContain('<ds:Signature');
    expect(signed.signedXml).toContain(DIAN_SIGNATURE_POLICY_ID);
    expect(verifyDianXadesSignature(signed.signedXml)).toEqual({
      valid: true,
      signingTime: '2026-11-26T14:30:00.000Z',
      certificateFingerprintSha256: signed.certificateFingerprintSha256,
    });
  });

  it('keeps replacement patterns in the certificate issuer literal', () => {
    const creds = createTestSelfSignedCert({
      notBefore: new Date('2025-01-01T00:00:00Z'),
      notAfter: new Date('2030-01-01T00:00:00Z'),
      cn: 'Andina $& Cia $1',
    });
    const xml = buildColombiaUbl21DraftXml(buildSampleInput(), 'e'.repeat(96), { mode: 'dian' });
    const { signedXml } = signDianUblXml({
      xml,
      certificatePem: creds.certificatePem,
      privateKeyPem: creds.privateKeyPem,
      signingTimeIso: '2026-11-26T14:30:00.000Z',
    });

    expect(signedXml).toContain('Andina $&amp; Cia $1');
    expect(verifyDianXadesSignature(signedXml).valid).toBe(true);
  });

  it('detects any payload or signing-time tampering', () => {
    const xml = buildColombiaUbl21DraftXml(buildSampleInput(), 'd'.repeat(96), { mode: 'dian' });
    const { signedXml } = signDianUblXml({
      xml,
      certificatePem: validCreds.certificatePem,
      privateKeyPem: validCreds.privateKeyPem,
      signingTimeIso: '2026-11-26T14:30:00.000Z',
    });

    const tamperedAmount = signedXml.replace(
      '222.00</cbc:PayableAmount>',
      '223.00</cbc:PayableAmount>'
    );
    expect(verifyDianXadesSignature(tamperedAmount)).toMatchObject({
      valid: false,
      reason: 'document_digest_mismatch',
    });

    const tamperedTime = signedXml.replace('2026-11-26T14:30:00.000Z', '2026-11-26T14:31:00.000Z');
    expect(verifyDianXadesSignature(tamperedTime)).toMatchObject({
      valid: false,
      reason: 'signed_properties_digest_mismatch',
    });
  });

  it('inspects certificate validity windows accurately', () => {
    const expiredCreds = createTestSelfSignedCert({
      notBefore: new Date('2020-01-01T00:00:00Z'),
      notAfter: new Date('2021-01-01T00:00:00Z'),
    });
    const summary = inspectX509Certificate(
      expiredCreds.certificatePem,
      new Date('2026-11-26T00:00:00Z')
    );
    expect(summary.valid).toBe(false);
    expect(summary.expired).toBe(true);
  });
});

describe('ColombiaDianAdapter + WS-Security SOAP 1.2 against mock DIAN transport', () => {
  const validCreds = createTestSelfSignedCert({
    notBefore: new Date('2025-01-01T00:00:00Z'),
    notAfter: new Date('2030-01-01T00:00:00Z'),
  });

  const endpoint = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc';
  let mockMode: 'accept' | 'testset' | 'reject' | 'outage' | 'status-accepted' = 'accept';
  let lastReceivedBody = '';

  const mockFetch: typeof fetch = async (_input, init) => {
    lastReceivedBody = typeof init?.body === 'string' ? init.body : '';
    if (mockMode === 'outage') {
      return new Response('Service Unavailable', { status: 503 });
    }
    const headers = { 'Content-Type': 'application/soap+xml; charset=utf-8' };
    if (mockMode === 'accept') {
      return new Response(
        `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><SendBillSyncResponse><SendBillSyncResult><b:IsValid>true</b:IsValid><b:StatusCode>00</b:StatusCode><b:StatusDescription>Procesado Correctamente.</b:StatusDescription><b:StatusMessage>La Factura electrónica SETP990000042, ha sido autorizada.</b:StatusMessage></SendBillSyncResult></SendBillSyncResponse></s:Body></s:Envelope>`,
        { status: 200, headers }
      );
    }
    if (mockMode === 'testset') {
      return new Response(
        `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><SendTestSetAsyncResponse><SendTestSetAsyncResult><b:ZipKey>zip-key-test-001</b:ZipKey></SendTestSetAsyncResult></SendTestSetAsyncResponse></s:Body></s:Envelope>`,
        { status: 200, headers }
      );
    }
    if (mockMode === 'reject') {
      return new Response(
        `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><SendBillSyncResponse><SendBillSyncResult><b:IsValid>false</b:IsValid><b:StatusCode>99</b:StatusCode><b:StatusDescription>Validación contiene errores</b:StatusDescription><b:ErrorMessage><c:string>Regla: FAK24, Rechazo: Firma inválida</c:string></b:ErrorMessage></SendBillSyncResult></SendBillSyncResponse></s:Body></s:Envelope>`,
        { status: 200, headers }
      );
    }
    return new Response(
      `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetStatusResponse><GetStatusResult><b:IsValid>true</b:IsValid><b:StatusCode>00</b:StatusCode><b:StatusDescription>Procesado Correctamente.</b:StatusDescription></GetStatusResult></GetStatusResponse></s:Body></s:Envelope>`,
      { status: 200, headers }
    );
  };

  it('registers dian-co-direct in describeFiscalProvider with honest draft maturity', () => {
    expect(describeFiscalProvider(COLOMBIA_DIAN_DIRECT_PROVIDER_ID)).toEqual({
      maturity: 'draft',
      countryCode: 'CO',
    });
  });

  it('requires a valid non-expired certificate in validateConfig', async () => {
    const noCert = new ColombiaDianAdapter();
    const res = await noCert.validateConfig({
      tenantId: 't1',
      countryCode: 'CO',
      settings: CO_SETTINGS,
    });
    expect(res.ok).toBe(false);
    expect(res.issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_CERTIFICATE', field: 'fiscal.co.certificate' })
    );

    const withCert = new ColombiaDianAdapter({
      credentials: validCreds,
      now: () => new Date('2026-11-26T12:00:00Z'),
    });
    const okRes = await withCert.validateConfig({
      tenantId: 't1',
      countryCode: 'CO',
      settings: CO_SETTINGS,
    });
    expect(okRes.ok).toBe(true);
  });

  it('builds a valid PKZIP archive, signs SOAP WS-Security + XAdES-EPES, and accepts SendBillSync', async () => {
    mockMode = 'accept';
    const adapter = new ColombiaDianAdapter({
      credentials: validCreds,
      endpointOverride: endpoint,
      fetchImpl: mockFetch,
      now: () => new Date('2026-11-26T14:30:00Z'),
    });

    const result = await adapter.issue(buildSampleInput());
    expect(result.status).toBe('accepted');
    expect(result.providerId).toBe(COLOMBIA_DIAN_DIRECT_PROVIDER_ID);
    expect(result.xmlRef).toBeTruthy();
    expect(verifyDianXadesSignature(result.xmlRef!).valid).toBe(true);

    // Verify WS-Security SOAP envelope and unzip the transmitted payload.
    expect(lastReceivedBody).toContain('<wsse:BinarySecurityToken');
    expect(lastReceivedBody).toContain('IWcfDianCustomerServices/SendBillSync');
    const contentMatch = lastReceivedBody.match(/<wcf:contentFile>([^<]+)<\/wcf:contentFile>/);
    expect(contentMatch).not.toBeNull();
    const zipBuf = Buffer.from(contentMatch![1]!, 'base64');
    // Standard PKZIP local file header magic PK\x03\x04
    expect(zipBuf.readUInt32LE(0)).toBe(0x04034b50);
    const nameLen = zipBuf.readUInt16LE(26);
    const compSize = zipBuf.readUInt32LE(18);
    const compressedData = zipBuf.subarray(30 + nameLen, 30 + nameLen + compSize);
    const unzippedXml = inflateRawSync(compressedData).toString('utf8');
    expect(verifyDianXadesSignature(unzippedXml).valid).toBe(true);
  });

  it('routes habilitacion testSetId through SendTestSetAsync and polls GetStatus', async () => {
    mockMode = 'testset';
    const adapter = new ColombiaDianAdapter({
      credentials: validCreds,
      endpointOverride: endpoint,
      fetchImpl: mockFetch,
      testSetId: 'test-set-uuid-1234',
      now: () => new Date('2026-11-26T14:30:00Z'),
    });

    const result = await adapter.issue(buildSampleInput({ kind: 'DEE' }));
    expect(result.status).toBe('sent');
    expect(result.providerResponse).toMatchObject({
      action: 'SendTestSetAsync',
      zipKey: 'zip-key-test-001',
    });

    mockMode = 'status-accepted';
    expect(await adapter.fetchStatus(result.cufe)).toBe('accepted');
  });

  it('rejects a private key that does not belong to the signing certificate', async () => {
    const other = createTestSelfSignedCert({
      notBefore: new Date('2025-01-01T00:00:00Z'),
      notAfter: new Date('2030-01-01T00:00:00Z'),
    });
    const adapter = new ColombiaDianAdapter({
      credentials: {
        certificatePem: validCreds.certificatePem,
        privateKeyPem: other.privateKeyPem,
      },
      now: () => new Date('2026-11-26T14:30:00Z'),
    });

    const result = await adapter.validateConfig({
      tenantId: 't1',
      countryCode: 'CO',
      settings: CO_SETTINGS,
    });
    expect(result.issues.map(issue => issue.message)).toContain(
      'DIAN private key does not match the signing certificate'
    );
  });

  it('embeds only the leaf certificate when the PEM carries a chain', () => {
    const issuer = createTestSelfSignedCert({
      notBefore: new Date('2025-01-01T00:00:00Z'),
      notAfter: new Date('2030-01-01T00:00:00Z'),
      cn: 'Puntovivo Test CA',
    });
    const chainPem = `Bag Attributes\n    friendlyName: dian\n${validCreds.certificatePem}\n${issuer.certificatePem}`;
    const leafBase64 = new X509Certificate(validCreds.certificatePem).raw.toString('base64');
    const xml = buildColombiaUbl21DraftXml(buildSampleInput(), 'f'.repeat(96), { mode: 'dian' });
    const { signedXml } = signDianUblXml({
      xml,
      certificatePem: chainPem,
      privateKeyPem: validCreds.privateKeyPem,
      signingTimeIso: '2026-11-26T14:30:00.000Z',
    });
    const envelope = buildDianSoapEnvelope({
      action: 'GetStatus',
      endpoint,
      bodyXml: '<wcf:GetStatus/>',
      credentials: { certificatePem: chainPem, privateKeyPem: validCreds.privateKeyPem },
    });

    expect(signedXml).toContain(`<ds:X509Certificate>${leafBase64}</ds:X509Certificate>`);
    expect(envelope).toContain(`>${leafBase64}</wsse:BinarySecurityToken>`);
    expect(verifyDianXadesSignature(signedXml).valid).toBe(true);
  });

  it('refuses to void instead of reporting an untransmitted cancellation as sent', async () => {
    const adapter = new ColombiaDianAdapter({
      credentials: validCreds,
      endpointOverride: endpoint,
      fetchImpl: mockFetch,
    });

    expect(adapter.capabilities.supportsVoid).toBe(false);
    await expect(
      adapter.voidDocument({ tenantId: 'tenant-co-1', cufe: 'a'.repeat(96), reasonCode: '2' })
    ).rejects.toMatchObject({ name: 'FiscalProviderError', providerCode: 'VOID_NOT_SUPPORTED' });
  });

  it('maps DIAN business rejection to non-recoverable PROVIDER_REJECTED', async () => {
    mockMode = 'reject';
    const adapter = new ColombiaDianAdapter({
      credentials: validCreds,
      endpointOverride: endpoint,
      fetchImpl: mockFetch,
      now: () => new Date('2026-11-26T14:30:00Z'),
    });

    await expect(adapter.issue(buildSampleInput())).rejects.toMatchObject({
      name: 'FiscalProviderError',
      normalizedKind: 'PROVIDER_REJECTED',
      providerCode: '99',
    });
  });

  it('falls back to signed Contingencia tipo 08 (48h) on DIAN 503 outage, or throws recoverable error when configured for outbox worker', async () => {
    mockMode = 'outage';
    const fallbackAdapter = new ColombiaDianAdapter({
      credentials: validCreds,
      endpointOverride: endpoint,
      fetchImpl: mockFetch,
      now: () => new Date('2026-11-26T14:30:00Z'),
    });
    const contingency = await fallbackAdapter.issue(buildSampleInput());
    expect(contingency.status).toBe('contingency');
    expect(contingency.providerResponse).toMatchObject({
      contingencyType: '08',
      contingencyDeadlineAt: '2026-11-28T14:30:00.000Z',
    });
    expect(contingency.xmlRef).toContain('<cbc:InvoiceTypeCode>03</cbc:InvoiceTypeCode>');
    expect(contingency.xmlRef).toContain('CONTINGENCIA_TIPO_08');
    expect(verifyDianXadesSignature(contingency.xmlRef!).valid).toBe(true);

    const workerAdapter = new ColombiaDianAdapter({
      credentials: validCreds,
      endpointOverride: endpoint,
      fetchImpl: mockFetch,
      outageBehavior: 'throw',
      now: () => new Date('2026-11-26T14:30:00Z'),
    });
    await expect(workerAdapter.issue(buildSampleInput())).rejects.toMatchObject({
      name: 'FiscalProviderError',
      normalizedKind: 'PROVIDER_5XX',
      providerCode: 'CONTINGENCY_08',
    });
  });

  it('produces a valid PKZIP buffer via buildSingleFileZip', () => {
    const zip = buildSingleFileZip('sample.xml', '<root/>');
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from('sample.xml', 'utf8'))).toBe(true);
  });
});
