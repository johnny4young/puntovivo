/**
 * Products tRPC Router
 *
 * CRUD, search, barcode lookup and semantic-search operations for products
 * with tenant isolation.
 *
 * Procedures:
 * - products.list                 (tenant) - List products with pagination
 * - products.getById              (tenant) - Get a single product
 * - products.create               (manager/admin) - Create a new product
 * - products.update               (manager/admin) - Update a product
 * - products.delete               (admin) - Soft-delete a product
 * - products.search               (tenant) - Full-text search
 * - products.lookupByBarcode      (tenant) - ENG-061 exact-match scanner lookup
 * - products.semanticSearch       (manager/admin, semantic-search module) - ENG-033
 * - products.regenerateEmbeddings (admin, semantic-search module) - ENG-068
 * - products.embeddingHealth      (manager/admin, semantic-search module) - ENG-040
 * - products.suggestCategory      (manager/admin, semantic-search module) - ENG-068
 *
 * ENG-178 — this barrel preserves the public surface of the former flat
 * `trpc/routers/products.ts` (1280 LOC), decomposed into per-concern modules
 * during the megafile wave. The procedure bodies + shared helpers moved
 * verbatim; only the file layout changed. The procedure paths
 * (`products.create`, etc.) and `AppRouter`'s inferred shape are unchanged, so
 * the web client and the caller-based tests are unaffected. ENG-207 moved
 * create/update use-cases into `application/products/` and shared catalog
 * primitives into `services/products/` while keeping procedure paths stable.
 *
 * @module trpc/routers/products
 */
import { router } from '../../init.js';
import { productQueryProcedures } from './queries.js';
import { productMutationProcedures } from './mutations.js';
import { productSemanticProcedures } from './semantic.js';

export const productsRouter = router({
  ...productQueryProcedures,
  ...productMutationProcedures,
  ...productSemanticProcedures,
});
