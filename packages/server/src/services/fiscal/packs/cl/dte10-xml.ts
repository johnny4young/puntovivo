/**
 * ENG-036b — Serializador de XML DTE 1.0 según especificación SII.
 *
 * Construye un Documento Tributario Electrónico estructuralmente válido a
 * partir del input estándar del orchestrator (`FiscalAdapterIssueInput`) +
 * los settings CL del tenant + la pre-allocación de folio del CAF
 * allocator. La función es pura — no toca DB ni red.
 *
 * Decomposed into per-concern modules under `dte10-xml/` (ENG-178 slice
 * 27): constants, types, format, nodes, serialize. This file stays as a
 * thin re-export barrel so existing importers resolve unchanged.
 *
 * @module services/fiscal/packs/cl/dte10-xml
 */

export * from './dte10-xml/index.js';
