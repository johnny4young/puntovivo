/**
 * Geography tRPC routers barrel.
 *
 * ENG-178 — preserves the public surface of the former flat
 * `trpc/routers/geography.ts` (878 LOC), decomposed into one file per entity
 * router + a shared `helpers.ts` leaf during the megafile wave. The three
 * routers (`countriesRouter` / `departmentsRouter` / `citiesRouter`) keep their
 * export names and flat procedure paths, so `AppRouter`'s inferred shape and the
 * caller-based tests are unchanged. `ensureCityExists` is re-exported here for
 * `providers.ts`, which validates a city against the tenant.
 *
 * @module trpc/routers/geography
 */
export { countriesRouter } from './countries.js';
export { departmentsRouter } from './departments.js';
export { citiesRouter } from './cities.js';
export { ensureCityExists } from './helpers.js';
