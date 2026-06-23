/**
 * ENG-075 — Authority Node device pairing and health projection.
 *
 * Pairing codes are tenant-scoped, one-time, and stored only as a
 * SHA-256 hash. The Operations Center Authority tab reads the topology
 * projection from this module so diagnostics export and UI stay aligned.
 *
 * Decomposed into per-concern modules under `authority/` (ENG-178 slice
 * 24). This file stays as a thin re-export barrel so existing importers
 * resolve unchanged.
 *
 * @module services/devices/authority
 */

export * from './authority/index.js';
