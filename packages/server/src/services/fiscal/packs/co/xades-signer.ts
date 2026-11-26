/**
 * Pure Node.js XAdES-EPES signer and verifier for Colombian DIAN UBL 2.1 documents.
 *
 * Uses built-in `node:crypto` (RSA-SHA256 + SHA-256 + X509Certificate) with deterministic
 * C14N 1.0 serialization so signing works offline without external native crypto libraries.
 *
 * @module services/fiscal/packs/co/xades-signer
 */

import { createHash, createSign, createVerify, randomUUID, X509Certificate } from 'node:crypto';

export const DIAN_SIGNATURE_POLICY_ID =
  'https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf';
export const DIAN_SIGNATURE_POLICY_HASH_SHA256_B64 = 'dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=';

const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#';
const C14N_1_0_URI = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA256_URI = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256_URI = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ENVELOPED_TRANSFORM_URI = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SIGNED_PROPERTIES_TYPE_URI = 'http://uri.etsi.org/01903#SignedProperties';

export interface X509CertificateSummary {
  valid: boolean;
  expired: boolean;
  notYetValid: boolean;
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  fingerprintSha256: string;
}

export interface SignDianUblXmlInput {
  xml: string;
  certificatePem: string;
  privateKeyPem: string;
  signingTimeIso?: string;
  signatureId?: string;
}

export interface SignDianUblXmlResult {
  signedXml: string;
  signatureId: string;
  documentDigestBase64: string;
  signatureValueBase64: string;
  certificateFingerprintSha256: string;
}

export interface VerifyDianXadesResult {
  valid: boolean;
  reason?: string;
  signingTime?: string;
  certificateFingerprintSha256?: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sha256Base64(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('base64');
}

/**
 * Deterministic C14N 1.0 normalization for controlled UBL/XAdES XML trees:
 * strips XML declaration, normalizes CRLF -> LF, expands empty elements,
 * and sorts namespace declarations before regular attributes lexicographically.
 */
export function canonicalizeXml(xml: string): string {
  const withoutDecl = xml.replace(/^\s*<\?xml[^?]*\?>\s*/i, '').replace(/\r\n?/g, '\n');
  return withoutDecl.replace(
    /<([A-Za-z_][\w:.-]*)((?:\s+[^>]*?)?)(\/?)>/g,
    (_m, tag, rawAttrs, selfClosing) => {
      const attrs: Array<{ name: string; value: string; isNs: boolean }> = [];
      const attrRegex = /\s+([A-Za-z_][\w:.-]*)="([^"]*)"/g;
      let match: RegExpExecArray | null;
      while ((match = attrRegex.exec(rawAttrs)) !== null) {
        const name = match[1]!;
        const value = match[2]!;
        attrs.push({ name, value, isNs: name === 'xmlns' || name.startsWith('xmlns:') });
      }
      attrs.sort((a, b) => {
        if (a.isNs !== b.isNs) return a.isNs ? -1 : 1;
        if (a.name === 'xmlns') return -1;
        if (b.name === 'xmlns') return 1;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      const renderedAttrs = attrs.map(attr => ` ${attr.name}="${attr.value}"`).join('');
      if (selfClosing === '/') {
        return `<${tag}${renderedAttrs}></${tag}>`;
      }
      return `<${tag}${renderedAttrs}>`;
    }
  );
}

/** DER base64 of the first (leaf) certificate, ignoring chain members and bag attributes. */
export function certificateDerBase64(certificatePem: string): string {
  return new X509Certificate(certificatePem).raw.toString('base64');
}

function hexSerialToDecimal(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (!clean) return '0';
  return BigInt(`0x${clean}`).toString(10);
}

/** Parse and validate X.509 PEM certificate dates and identity. */
export function inspectX509Certificate(
  certificatePem: string,
  now: Date = new Date()
): X509CertificateSummary {
  const cert = new X509Certificate(certificatePem);
  const notBeforeDate = new Date(cert.validFrom);
  const notAfterDate = new Date(cert.validTo);
  const expired = now.getTime() > notAfterDate.getTime();
  const notYetValid = now.getTime() < notBeforeDate.getTime();
  return {
    valid: !expired && !notYetValid,
    expired,
    notYetValid,
    subject: cert.subject.replace(/\n/g, ', '),
    issuer: cert.issuer.replace(/\n/g, ', '),
    serialNumber: hexSerialToDecimal(cert.serialNumber),
    notBefore: notBeforeDate.toISOString(),
    notAfter: notAfterDate.toISOString(),
    fingerprintSha256: cert.fingerprint256,
  };
}

/**
 * Sign a DIAN UBL 2.1 XML document with an enveloped XAdES-EPES signature (RSA-SHA256)
 * into the empty `<ext:ExtensionContent/>` placeholder.
 */
export function signDianUblXml(input: SignDianUblXmlInput): SignDianUblXmlResult {
  const cert = new X509Certificate(input.certificatePem);
  const certDer = cert.raw;
  const certBase64 = certDer.toString('base64');
  const certDigestBase64 = sha256Base64(certDer);

  const signatureId = input.signatureId ?? `xmldsig-${randomUUID()}`;
  const keyInfoId = `${signatureId}-keyinfo`;
  const signedPropsId = `${signatureId}-signedprops`;
  const refDocId = `${signatureId}-ref0`;
  const sigValueId = `${signatureId}-sigvalue`;
  const signingTime = input.signingTimeIso ?? new Date().toISOString();
  const issuerName = cert.issuer.replace(/\n/g, ', ');
  const serialDecimal = hexSerialToDecimal(cert.serialNumber);

  // Enveloped signature digest covers the canonical document without <ds:Signature>.
  const documentDigestBase64 = sha256Base64(canonicalizeXml(input.xml));

  const keyInfoXml =
    `<ds:KeyInfo Id="${escapeXml(keyInfoId)}" xmlns:ds="${XMLDSIG_NS}">` +
    `<ds:X509Data><ds:X509Certificate>${certBase64}</ds:X509Certificate></ds:X509Data>` +
    `</ds:KeyInfo>`;
  const keyInfoDigestBase64 = sha256Base64(canonicalizeXml(keyInfoXml));

  const signedPropertiesXml =
    `<xades:SignedProperties Id="${escapeXml(signedPropsId)}" xmlns:ds="${XMLDSIG_NS}" xmlns:xades="${XADES_NS}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${escapeXml(signingTime)}</xades:SigningTime>` +
    `<xades:SigningCertificate>` +
    `<xades:Cert>` +
    `<xades:CertDigest><ds:DigestMethod Algorithm="${SHA256_URI}"/><ds:DigestValue>${certDigestBase64}</ds:DigestValue></xades:CertDigest>` +
    `<xades:IssuerSerial><ds:X509IssuerName>${escapeXml(issuerName)}</ds:X509IssuerName><ds:X509SerialNumber>${serialDecimal}</ds:X509SerialNumber></xades:IssuerSerial>` +
    `</xades:Cert>` +
    `</xades:SigningCertificate>` +
    `<xades:SignaturePolicyIdentifier>` +
    `<xades:SignaturePolicyId>` +
    `<xades:SigPolicyId><xades:Identifier>${DIAN_SIGNATURE_POLICY_ID}</xades:Identifier></xades:SigPolicyId>` +
    `<xades:SigPolicyHash><ds:DigestMethod Algorithm="${SHA256_URI}"/><ds:DigestValue>${DIAN_SIGNATURE_POLICY_HASH_SHA256_B64}</ds:DigestValue></xades:SigPolicyHash>` +
    `</xades:SignaturePolicyId>` +
    `</xades:SignaturePolicyIdentifier>` +
    `<xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`;
  const signedPropsDigestBase64 = sha256Base64(canonicalizeXml(signedPropertiesXml));

  const signedInfoXml =
    `<ds:SignedInfo xmlns:ds="${XMLDSIG_NS}">` +
    `<ds:CanonicalizationMethod Algorithm="${C14N_1_0_URI}"/>` +
    `<ds:SignatureMethod Algorithm="${RSA_SHA256_URI}"/>` +
    `<ds:Reference Id="${escapeXml(refDocId)}" URI="">` +
    `<ds:Transforms><ds:Transform Algorithm="${ENVELOPED_TRANSFORM_URI}"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256_URI}"/>` +
    `<ds:DigestValue>${documentDigestBase64}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference URI="#${escapeXml(keyInfoId)}">` +
    `<ds:DigestMethod Algorithm="${SHA256_URI}"/>` +
    `<ds:DigestValue>${keyInfoDigestBase64}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Type="${SIGNED_PROPERTIES_TYPE_URI}" URI="#${escapeXml(signedPropsId)}">` +
    `<ds:DigestMethod Algorithm="${SHA256_URI}"/>` +
    `<ds:DigestValue>${signedPropsDigestBase64}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`;

  const signer = createSign('RSA-SHA256');
  signer.update(canonicalizeXml(signedInfoXml));
  signer.end();
  const signatureValueBase64 = signer.sign(input.privateKeyPem, 'base64');

  const signatureBlock =
    `<ds:Signature Id="${escapeXml(signatureId)}" xmlns:ds="${XMLDSIG_NS}">` +
    signedInfoXml +
    `<ds:SignatureValue Id="${escapeXml(sigValueId)}">${signatureValueBase64}</ds:SignatureValue>` +
    keyInfoXml +
    `<ds:Object><xades:QualifyingProperties Target="#${escapeXml(signatureId)}" xmlns:xades="${XADES_NS}">${signedPropertiesXml}</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>`;

  const slotPattern = /<ext:ExtensionContent\s*\/>|<ext:ExtensionContent><\/ext:ExtensionContent>/;
  if (!slotPattern.test(input.xml)) {
    throw new Error('UBL XML is missing an empty <ext:ExtensionContent/> signature slot');
  }
  const signedXml = input.xml.replace(
    slotPattern,
    () => `<ext:ExtensionContent>${signatureBlock}</ext:ExtensionContent>`
  );

  return {
    signedXml,
    signatureId,
    documentDigestBase64,
    signatureValueBase64,
    certificateFingerprintSha256: cert.fingerprint256,
  };
}

/**
 * Cryptographically verify an enveloped XAdES-EPES DIAN signature against its embedded X.509 certificate.
 */
export function verifyDianXadesSignature(signedXml: string): VerifyDianXadesResult {
  const sigMatch = signedXml.match(/<ds:Signature\b[^>]*>[\s\S]*?<\/ds:Signature>/);
  if (!sigMatch) return { valid: false, reason: 'missing_signature_element' };
  const sigXml = sigMatch[0];

  const signedInfoMatch = sigXml.match(/<ds:SignedInfo\b[^>]*>[\s\S]*?<\/ds:SignedInfo>/);
  const sigValueMatch = sigXml.match(/<ds:SignatureValue\b[^>]*>([\s\S]*?)<\/ds:SignatureValue>/);
  const keyInfoMatch = sigXml.match(/<ds:KeyInfo\b[^>]*>[\s\S]*?<\/ds:KeyInfo>/);
  const certMatch = sigXml.match(/<ds:X509Certificate>([\s\S]*?)<\/ds:X509Certificate>/);
  const signedPropsMatch = sigXml.match(
    /<xades:SignedProperties\b[^>]*>[\s\S]*?<\/xades:SignedProperties>/
  );

  if (!signedInfoMatch || !sigValueMatch || !keyInfoMatch || !certMatch || !signedPropsMatch) {
    return { valid: false, reason: 'malformed_xades_structure' };
  }

  const certBase64 = certMatch[1]!.replace(/\s+/g, '');
  const certPem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n') ?? certBase64}\n-----END CERTIFICATE-----\n`;
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    return { valid: false, reason: 'invalid_x509_certificate' };
  }

  // 1. Verify RSA-SHA256 signature over canonicalized <ds:SignedInfo>.
  const verifier = createVerify('RSA-SHA256');
  verifier.update(canonicalizeXml(signedInfoMatch[0]));
  verifier.end();
  const sigValid = verifier.verify(cert.publicKey, sigValueMatch[1]!.replace(/\s+/g, ''), 'base64');
  if (!sigValid) {
    return { valid: false, reason: 'signature_value_mismatch' };
  }

  // 2. Verify all three references: document (enveloped), KeyInfo, and SignedProperties.
  const digestMatches = [
    ...signedInfoMatch[0].matchAll(
      /<ds:Reference\b[^>]*\bURI="([^"]*)"[^>]*>[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>[\s\S]*?<\/ds:Reference>/g
    ),
  ];
  if (digestMatches.length < 3) {
    return { valid: false, reason: 'missing_digest_references' };
  }

  const unsignedDoc = signedXml.replace(sigXml, '');
  const expectedDocDigest = sha256Base64(canonicalizeXml(unsignedDoc));
  const expectedKeyInfoDigest = sha256Base64(canonicalizeXml(keyInfoMatch[0]));
  const expectedPropsDigest = sha256Base64(canonicalizeXml(signedPropsMatch[0]));

  for (const [, uri, digest] of digestMatches) {
    if (uri === '') {
      if (digest !== expectedDocDigest) return { valid: false, reason: 'document_digest_mismatch' };
    } else if (uri?.endsWith('-keyinfo')) {
      if (digest !== expectedKeyInfoDigest) {
        return { valid: false, reason: 'keyinfo_digest_mismatch' };
      }
    } else if (uri?.endsWith('-signedprops')) {
      if (digest !== expectedPropsDigest) {
        return { valid: false, reason: 'signed_properties_digest_mismatch' };
      }
    }
  }

  const signingTime = signedPropsMatch[0].match(
    /<xades:SigningTime>([^<]+)<\/xades:SigningTime>/
  )?.[1];

  return {
    valid: true,
    ...(signingTime ? { signingTime } : {}),
    certificateFingerprintSha256: cert.fingerprint256,
  };
}
