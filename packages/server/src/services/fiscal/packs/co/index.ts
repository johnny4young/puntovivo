/**
 * Colombia fiscal pack — public exports.
 *
 * @module services/fiscal/packs/co
 */
export { ColombiaMockAdapter, type MockAdapterOptions } from './mock-adapter.js';
export {
  COLOMBIA_DIAN_DIRECT_PROVIDER_ID,
  ColombiaDianAdapter,
  type ColombiaDianAdapterOptions,
} from './dian-adapter.js';
export {
  buildDianSoapEnvelope,
  buildSingleFileZip,
  DIAN_SOAP_ENDPOINTS,
  DianSoapClient,
  parseDianSoapResponse,
  type DianSoapAction,
  type DianSoapCredentials,
  type DianSoapResponse,
} from './dian-soap-client.js';
export {
  certificateDerBase64,
  DIAN_SIGNATURE_POLICY_HASH_SHA256_B64,
  DIAN_SIGNATURE_POLICY_ID,
  inspectX509Certificate,
  signDianUblXml,
  verifyDianXadesSignature,
} from './xades-signer.js';
