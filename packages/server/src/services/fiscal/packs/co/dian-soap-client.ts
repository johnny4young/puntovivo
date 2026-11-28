/**
 * Pure Node.js DIAN WS-Security SOAP 1.2 client (`SendBillSync`, `SendTestSetAsync`,
 * `GetStatus`, `GetStatusZip`) with minimal standard PKZIP packaging.
 *
 * @module services/fiscal/packs/co/dian-soap-client
 */

import { randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import type { FiscalEnvironment } from '../../cufe.js';
import { certificateDerBase64 } from './xades-signer.js';

export const DIAN_SOAP_ENDPOINTS: Record<FiscalEnvironment, string> = {
  '1': 'https://vpfe.dian.gov.co/WcfDianCustomerServices.svc',
  '2': 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc',
};

const SOAP12_NS = 'http://www.w3.org/2003/05/soap-envelope';
const WSA_NS = 'http://www.w3.org/2005/08/addressing';
const WCF_NS = 'http://wcf.dian.colombia';
const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const WSU_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const EXC_C14N_URI = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const RSA_SHA256_URI = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256_URI = 'http://www.w3.org/2001/04/xmlenc#sha256';
const WSS_BASE64_URI =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';
const X509V3_TOKEN_URI =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3';

export type DianSoapAction = 'SendBillSync' | 'SendTestSetAsync' | 'GetStatus' | 'GetStatusZip';

export interface DianSoapCredentials {
  certificatePem: string;
  privateKeyPem: string;
}

export interface DianSoapFault {
  code: string;
  subcode: string | null;
  reason: string;
}

export interface DianSoapResponse {
  httpStatus: number;
  fault: DianSoapFault | null;
  isValid: boolean;
  statusCode: string | null;
  statusDescription: string | null;
  statusMessage: string | null;
  zipKey: string | null;
  errorMessages: string[];
  rawXml: string;
}

export interface DianSoapClientOptions {
  environment: FiscalEnvironment;
  credentials: DianSoapCredentials;
  endpointOverride?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a standard single-entry PKZIP archive in memory (DEFLATE, zero external deps). */
export function buildSingleFileZip(fileName: string, content: string | Buffer): Buffer {
  const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const compressed = deflateRawSync(raw);
  const nameBuf = Buffer.from(fileName, 'utf8');
  const checksum = crc32(raw);

  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
  localHeader.writeUInt16LE(20, 4); // version needed (2.0)
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(8, 8); // compression method: DEFLATE
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(raw.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra length
  nameBuf.copy(localHeader, 30);

  const centralOffset = localHeader.length + compressed.length;
  const centralHeader = Buffer.alloc(46 + nameBuf.length);
  centralHeader.writeUInt32LE(0x02014b50, 0); // central dir signature
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(8, 10); // DEFLATE
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(raw.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42); // local header offset
  nameBuf.copy(centralHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); // entries on disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localHeader, compressed, centralHeader, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Build a WS-Security signed SOAP 1.2 envelope for a DIAN WCF operation. */
export function buildDianSoapEnvelope(args: {
  action: DianSoapAction;
  endpoint: string;
  bodyXml: string;
  credentials: DianSoapCredentials;
  now?: Date;
}): string {
  const now = args.now ?? new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const tokenId = `X509-${randomUUID()}`;
  const timestampId = `TS-${randomUUID()}`;
  const toId = `TO-${randomUUID()}`;
  const certBase64 = certificateDerBase64(args.credentials.certificatePem);
  const actionUri = `http://wcf.dian.colombia/IWcfDianCustomerServices/${args.action}`;

  const unsignedEnvelope =
    `<soap:Envelope xmlns:soap="${SOAP12_NS}" xmlns:wcf="${WCF_NS}">` +
    `<soap:Header xmlns:wsa="${WSA_NS}">` +
    `<wsse:Security xmlns:wsse="${WSSE_NS}" xmlns:wsu="${WSU_NS}" soap:mustUnderstand="true">` +
    `<wsu:Timestamp wsu:Id="${timestampId}">` +
    `<wsu:Created>${now.toISOString()}</wsu:Created>` +
    `<wsu:Expires>${expires.toISOString()}</wsu:Expires>` +
    `</wsu:Timestamp>` +
    `<wsse:BinarySecurityToken EncodingType="${WSS_BASE64_URI}" ValueType="${X509V3_TOKEN_URI}" wsu:Id="${tokenId}">${certBase64}</wsse:BinarySecurityToken>` +
    `</wsse:Security>` +
    `<wsa:Action>${actionUri}</wsa:Action>` +
    `<wsa:To xmlns:wsu="${WSU_NS}" wsu:Id="${toId}">${escapeXml(args.endpoint)}</wsa:To>` +
    `</soap:Header>` +
    `<soap:Body>${args.bodyXml}</soap:Body>` +
    `</soap:Envelope>`;

  const sig = new SignedXml({
    idMode: 'wssecurity',
    privateKey: args.credentials.privateKeyPem,
    canonicalizationAlgorithm: EXC_C14N_URI,
    signatureAlgorithm: RSA_SHA256_URI,
    getKeyInfoContent: () =>
      `<wsse:SecurityTokenReference><wsse:Reference URI="#${tokenId}" ValueType="${X509V3_TOKEN_URI}"/></wsse:SecurityTokenReference>`,
  });
  for (const id of [timestampId, toId]) {
    sig.addReference({
      xpath: `//*[@*[local-name(.)='Id' and namespace-uri(.)='${WSU_NS}']='${id}']`,
      transforms: [EXC_C14N_URI],
      digestAlgorithm: SHA256_URI,
    });
  }
  sig.computeSignature(unsignedEnvelope, {
    prefix: 'ds',
    existingPrefixes: { wsse: WSSE_NS, wsu: WSU_NS },
    location: { reference: `//*[local-name(.)='Security']`, action: 'append' },
  });

  return `<?xml version="1.0" encoding="UTF-8"?>${sig.getSignedXml()}`;
}

function extractTag(xml: string, localName: string): string | null {
  const regex = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`,
    'i'
  );
  const match = xml.match(regex);
  return match ? match[1]!.trim() : null;
}

function extractErrorMessages(xml: string): string[] {
  const block = extractTag(xml, 'ErrorMessage');
  if (!block) return [];
  const strings = [
    ...block.matchAll(/<(?:[\w-]+:)?string\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?string>/gi),
  ]
    .map(m => m[1]!.trim())
    .filter(Boolean);
  if (strings.length > 0) return strings;
  const plain = block.replace(/<[^>]+>/g, '').trim();
  return plain ? [plain] : [];
}

function extractFault(xml: string): DianSoapFault | null {
  const fault = extractTag(xml, 'Fault');
  if (fault === null) return null;
  const values = [
    ...fault.matchAll(/<(?:[\w-]+:)?Value\b[^>]*>([^<]*)<\/(?:[\w-]+:)?Value>/gi),
  ].map(m => m[1]!.trim());
  return {
    code: values[0] ?? extractTag(fault, 'faultcode') ?? 'Unknown',
    subcode: values[1] ?? null,
    reason: extractTag(fault, 'Text') ?? extractTag(fault, 'faultstring') ?? '',
  };
}

/** Parse a DIAN WCF SOAP response XML into structured status fields. */
export function parseDianSoapResponse(httpStatus: number, rawXml: string): DianSoapResponse {
  const isValidRaw = extractTag(rawXml, 'IsValid');
  const statusCode = extractTag(rawXml, 'StatusCode');
  const statusDescription = extractTag(rawXml, 'StatusDescription');
  const statusMessage = extractTag(rawXml, 'StatusMessage');
  const zipKey = extractTag(rawXml, 'ZipKey');
  const errorMessages = extractErrorMessages(rawXml);
  const isValid = isValidRaw?.toLowerCase() === 'true' || statusCode === '00';
  return {
    httpStatus,
    fault: extractFault(rawXml),
    isValid,
    statusCode,
    statusDescription,
    statusMessage,
    zipKey,
    errorMessages,
    rawXml,
  };
}

export class DianSoapClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DianSoapClientOptions) {
    this.endpoint = options.endpointOverride ?? DIAN_SOAP_ENDPOINTS[options.environment];
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendBillSync(fileName: string, signedXml: string): Promise<DianSoapResponse> {
    const zipBase64 = buildSingleFileZip(fileName, signedXml).toString('base64');
    const zipName = fileName.replace(/\.xml$/i, '.zip');
    const bodyXml = `<wcf:SendBillSync><wcf:fileName>${escapeXml(zipName)}</wcf:fileName><wcf:contentFile>${zipBase64}</wcf:contentFile></wcf:SendBillSync>`;
    return this.invoke('SendBillSync', bodyXml);
  }

  async sendTestSetAsync(
    fileName: string,
    signedXml: string,
    testSetId: string
  ): Promise<DianSoapResponse> {
    const zipBase64 = buildSingleFileZip(fileName, signedXml).toString('base64');
    const zipName = fileName.replace(/\.xml$/i, '.zip');
    const bodyXml = `<wcf:SendTestSetAsync><wcf:fileName>${escapeXml(zipName)}</wcf:fileName><wcf:contentFile>${zipBase64}</wcf:contentFile><wcf:testSetId>${escapeXml(testSetId)}</wcf:testSetId></wcf:SendTestSetAsync>`;
    return this.invoke('SendTestSetAsync', bodyXml);
  }

  async getStatus(trackId: string): Promise<DianSoapResponse> {
    const bodyXml = `<wcf:GetStatus><wcf:trackId>${escapeXml(trackId)}</wcf:trackId></wcf:GetStatus>`;
    return this.invoke('GetStatus', bodyXml);
  }

  async getStatusZip(trackId: string): Promise<DianSoapResponse> {
    const bodyXml = `<wcf:GetStatusZip><wcf:trackId>${escapeXml(trackId)}</wcf:trackId></wcf:GetStatusZip>`;
    return this.invoke('GetStatusZip', bodyXml);
  }

  private async invoke(action: DianSoapAction, bodyXml: string): Promise<DianSoapResponse> {
    const envelope = buildDianSoapEnvelope({
      action,
      endpoint: this.endpoint,
      bodyXml,
      credentials: this.options.credentials,
    });
    const actionUri = `http://wcf.dian.colombia/IWcfDianCustomerServices/${action}`;
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${actionUri}"`,
        Accept: 'application/soap+xml, text/xml',
      },
      body: envelope,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const rawXml = await response.text();
    return parseDianSoapResponse(response.status, rawXml);
  }
}
