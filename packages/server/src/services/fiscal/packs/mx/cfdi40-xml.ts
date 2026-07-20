/**
 * Serializador de XML CFDI 4.0 según Anexo 20 SAT.
 *
 * Construye un comprobante CFDI 4.0 estructuralmente válido a partir del
 * input estándar del orchestrator (`FiscalAdapterIssueInput`) y los
 * settings MX del tenant. La función es pura — no toca DB ni red.
 *
 * Decomposed into per-concern modules under `cfdi40-xml/` ( slice
 * 26): constants, types, format, receptor, concepto, serialize. This file
 * stays as a thin re-export barrel so existing importers resolve unchanged.
 *
 * @module services/fiscal/packs/mx/cfdi40-xml
 */

export * from './cfdi40-xml/index.js';
