/**
 * XAdES-EPES signer and verifier for Colombian DIAN UBL 2.1 documents.
 *
 * Canonicalization and reference digests come from xml-crypto, which computes inclusive
 * C14N 1.0 in document context, so in-scope namespaces of the UBL root are part of every
 * digest exactly as DIAN recomputes them.
 *
 * @module services/fiscal/packs/co/xades-signer
 */

import { createHash, randomUUID, X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

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
const SIGNATURE_SLOT_XPATH =
  "//*[local-name(.)='UBLExtension']/*[local-name(.)='ExtensionContent' and not(*)]";

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

function sha256Base64(data: Buffer): string {
  return createHash('sha256').update(data).digest('base64');
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

/**
 * RFC 4514 distinguished name (most specific RDN first) from Node's multiline issuer, whose
 * values OpenSSL already escapes per RFC 2253.
 */
function toRfc4514Name(nodeName: string): string {
  return nodeName.split('\n').filter(Boolean).reverse().join(',');
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
  const certBase64 = cert.raw.toString('base64');

  const signatureId = input.signatureId ?? `xmldsig-${randomUUID()}`;
  const keyInfoId = `${signatureId}-keyinfo`;
  const signedPropsId = `${signatureId}-signedprops`;
  const signingTime = input.signingTimeIso ?? new Date().toISOString();

  const signedPropertiesXml =
    `<xades:SignedProperties Id="${escapeXml(signedPropsId)}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${escapeXml(signingTime)}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert>` +
    `<xades:CertDigest><ds:DigestMethod Algorithm="${SHA256_URI}"/><ds:DigestValue>${sha256Base64(cert.raw)}</ds:DigestValue></xades:CertDigest>` +
    `<xades:IssuerSerial><ds:X509IssuerName>${escapeXml(toRfc4514Name(cert.issuer))}</ds:X509IssuerName><ds:X509SerialNumber>${hexSerialToDecimal(cert.serialNumber)}</ds:X509SerialNumber></xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate>` +
    `<xades:SignaturePolicyIdentifier><xades:SignaturePolicyId>` +
    `<xades:SigPolicyId><xades:Identifier>${DIAN_SIGNATURE_POLICY_ID}</xades:Identifier></xades:SigPolicyId>` +
    `<xades:SigPolicyHash><ds:DigestMethod Algorithm="${SHA256_URI}"/><ds:DigestValue>${DIAN_SIGNATURE_POLICY_HASH_SHA256_B64}</ds:DigestValue></xades:SigPolicyHash>` +
    `</xades:SignaturePolicyId></xades:SignaturePolicyIdentifier>` +
    `<xades:SignerRole><xades:ClaimedRoles><xades:ClaimedRole>supplier</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRole>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`;

  const sig = new SignedXml({
    privateKey: input.privateKeyPem,
    canonicalizationAlgorithm: C14N_1_0_URI,
    signatureAlgorithm: RSA_SHA256_URI,
    keyInfoAttributes: { Id: keyInfoId },
    getKeyInfoContent: ({ prefix } = {}) => {
      const p = prefix ? `${prefix}:` : '';
      return `<${p}X509Data><${p}X509Certificate>${certBase64}</${p}X509Certificate></${p}X509Data>`;
    },
    objects: [
      {
        content: `<xades:QualifyingProperties xmlns:xades="${XADES_NS}" Target="#${escapeXml(signatureId)}">${signedPropertiesXml}</xades:QualifyingProperties>`,
      },
    ],
  });
  sig.addReference({
    xpath: '/*',
    transforms: [ENVELOPED_TRANSFORM_URI],
    digestAlgorithm: SHA256_URI,
    isEmptyUri: true,
    id: `${signatureId}-ref0`,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='KeyInfo' and @Id='${keyInfoId}']`,
    transforms: [C14N_1_0_URI],
    digestAlgorithm: SHA256_URI,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='SignedProperties' and @Id='${signedPropsId}']`,
    transforms: [C14N_1_0_URI],
    digestAlgorithm: SHA256_URI,
    type: SIGNED_PROPERTIES_TYPE_URI,
  });

  const slotDoc = new DOMParser().parseFromString(input.xml, 'text/xml');
  const slots = Array.from(
    slotDoc.getElementsByTagNameNS(
      'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
      'ExtensionContent'
    )
  ).filter(node => !Array.from(node.childNodes).some(child => child.nodeType === 1));
  if (slots.length !== 1) {
    throw new Error(
      'UBL XML must contain exactly one empty <ext:ExtensionContent/> signature slot'
    );
  }

  sig.computeSignature(input.xml, {
    prefix: 'ds',
    attrs: { Id: signatureId },
    location: { reference: SIGNATURE_SLOT_XPATH, action: 'append' },
  });

  return {
    signedXml: sig.getSignedXml(),
    signatureId,
    certificateFingerprintSha256: cert.fingerprint256,
  };
}

function childElement(parent: Element, namespace: string, localName: string): Element | null {
  return parent.getElementsByTagNameNS(namespace, localName).item(0);
}

/**
 * Verify an enveloped XAdES-EPES DIAN signature before transmission.
 *
 * This is a self-consistency check against the embedded certificate (or `trustedCertificatePem`
 * when given): it never establishes trust in the signer, which DIAN decides on receipt.
 */
export function verifyDianXadesSignature(
  signedXml: string,
  options: { trustedCertificatePem?: string } = {}
): VerifyDianXadesResult {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  } catch {
    return { valid: false, reason: 'malformed_xml' };
  }
  const signatures = doc.getElementsByTagNameNS(XMLDSIG_NS, 'Signature');
  if (signatures.length !== 1) {
    return {
      valid: false,
      reason: signatures.length === 0 ? 'missing_signature_element' : 'multiple_signatures',
    };
  }
  const signature = signatures.item(0)!;
  const certNode = childElement(signature, XMLDSIG_NS, 'X509Certificate');
  const signedProps = childElement(signature, XADES_NS, 'SignedProperties');
  if (!certNode?.textContent || !signedProps) {
    return { valid: false, reason: 'malformed_xades_structure' };
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(Buffer.from(certNode.textContent.replace(/\s+/g, ''), 'base64'));
  } catch {
    return { valid: false, reason: 'invalid_x509_certificate' };
  }
  if (options.trustedCertificatePem) {
    const trusted = new X509Certificate(options.trustedCertificatePem);
    if (!trusted.raw.equals(cert.raw)) {
      return { valid: false, reason: 'untrusted_certificate' };
    }
  }

  const certDigest = childElement(
    childElement(signedProps, XADES_NS, 'CertDigest') ?? signedProps,
    XMLDSIG_NS,
    'DigestValue'
  )?.textContent;
  if (certDigest?.trim() !== sha256Base64(cert.raw)) {
    return { valid: false, reason: 'certificate_digest_mismatch' };
  }

  const references = Array.from(signature.getElementsByTagNameNS(XMLDSIG_NS, 'Reference'));
  const uris = references.map(ref => ref.getAttribute('URI'));
  const keyInfoId = childElement(signature, XMLDSIG_NS, 'KeyInfo')?.getAttribute('Id');
  const signedPropsId = signedProps.getAttribute('Id');
  if (
    references.length !== 3 ||
    !uris.includes('') ||
    !keyInfoId ||
    !uris.includes(`#${keyInfoId}`) ||
    !signedPropsId ||
    !references.some(
      ref =>
        ref.getAttribute('URI') === `#${signedPropsId}` &&
        ref.getAttribute('Type') === SIGNED_PROPERTIES_TYPE_URI
    )
  ) {
    return { valid: false, reason: 'missing_digest_references' };
  }

  const verifier = new SignedXml({ publicCert: cert.toString() });
  verifier.loadSignature(signature);
  try {
    if (!verifier.checkSignature(signedXml)) {
      return { valid: false, reason: 'reference_digest_mismatch' };
    }
  } catch {
    return { valid: false, reason: 'signature_value_mismatch' };
  }

  const signingTime = childElement(signedProps, XADES_NS, 'SigningTime')?.textContent ?? undefined;
  return {
    valid: true,
    ...(signingTime ? { signingTime } : {}),
    certificateFingerprintSha256: cert.fingerprint256,
  };
}
