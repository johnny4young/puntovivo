/**
 * Products router semantic-search + AI procedures.
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/products.ts`
 * during the megafile decomposition. Exported as a procedure record that
 * `index.ts` spreads into the assembled `productsRouter` (paths unchanged).
 * All four procedures stay gated behind the `semantic-search` module (ENG-068).
 *
 * @module trpc/routers/products/semantic
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  adminProcedureWithModule,
  managerOrAdminProcedureWithModule,
} from '../../middleware/modules.js';
import {
  categories,
  locations,
  products,
  providers,
  vatRates,
} from '../../../db/schema.js';
import {
  regenerateProductEmbeddings,
  resolveActiveEmbeddingModelId,
  semanticSearchProducts,
  suggestProductCategory,
} from '../../../services/ai/embeddings.js';
import { productSelection } from '../../../services/products/product-read.js';

export const productSemanticProcedures = {
  // ==========================================================================
  // ENG-033 — semantic search + auto-categorize procedures
  // --------------------------------------------------------------------------
  // Semantic search runs cosine similarity over embedded product names
  // and falls back to LIKE when AI is disabled or the tenant has no
  // embeddings yet. Regenerate is admin-only and re-embeds the entire
  // catalog (used after an embedding model upgrade or bulk import).
  // SuggestCategory is invoked at product create time to pre-fill the
  // category picker; the model is constrained to existing category ids
  // via Zod enum so it cannot hallucinate a new category.
  // ==========================================================================

  // ENG-068 — gated behind the `semantic-search` module. Tenants on
  // a basic plan keep the regular LIKE search; the toggle
  // (sparkles) on ProductsPage hides when the module is off.
  semanticSearch: managerOrAdminProcedureWithModule('semantic-search')
    .input(
      z.object({
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(50).default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const ranked = await semanticSearchProducts(
        ctx.db,
        ctx.tenantId,
        input.query,
        input.limit
      );
      // ranked === null → AI disabled or provider can't embed.
      // The frontend should fall back to the regular list endpoint
      // with `search=...` (LIKE-based) in that case.
      if (ranked === null) {
        return { mode: 'unavailable' as const, results: [] };
      }
      // Hydrate full product rows for the ranked ids in one shot.
      if (ranked.length === 0) {
        return { mode: 'semantic' as const, results: [] };
      }
      const ids = ranked.map(r => r.productId);
      const rows = await ctx.db
        .select(productSelection)
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(locations, eq(products.locationId, locations.id))
        .leftJoin(providers, eq(products.providerId, providers.id))
        .leftJoin(vatRates, eq(products.vatRateId, vatRates.id))
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, ids)))
        .all();
      const byId = new Map(rows.map(r => [r.id, r]));
      const ordered = ranked
        .map(r => {
          const row = byId.get(r.productId);
          if (!row) return null;
          return { ...row, similarity: r.similarity };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      return { mode: 'semantic' as const, results: ordered };
    }),

  // ENG-068 — gated behind `semantic-search`. Regenerating
  // embeddings only matters when the search surface is active.
  regenerateEmbeddings: adminProcedureWithModule('semantic-search').mutation(async ({ ctx }) => {
    const result = await regenerateProductEmbeddings(ctx.db, ctx.tenantId);
    if (result === null) {
      return { ok: false as const, reason: 'ai-disabled-or-empty' as const, embedded: 0 };
    }
    return { ok: true as const, embedded: result.embedded, model: result.model };
  }),

  // ENG-040 — embedding model drift detection. Drives the admin
  // banner on ProductsPage that nudges the operator to regenerate
  // after switching AI providers (OpenAI 1536-d ↔ Ollama 768-d).
  // The dimension mismatch silently collapses semantic search
  // result counts because `cosineSimilarity` returns 0 for vectors
  // of different lengths and the 0.30 floor filters them out; this
  // query gives the operator the signal that's otherwise invisible.
  //
  // Returned `mode='unavailable'` when AI is off / the provider
  // doesn't embed — the banner stays hidden in that case because
  // there's no active baseline to compare against. `staleCount`
  // counts rows whose `embedding_model` differs from the active
  // model id (NULL embedding rows are unembedded, not stale).
  embeddingHealth: managerOrAdminProcedureWithModule('semantic-search').query(
    async ({ ctx }) => {
      const activeModelId = await resolveActiveEmbeddingModelId(
        ctx.db,
        ctx.tenantId
      );

      // One scan over the tenant's products with conditional aggregates.
      // `lastEmbeddedAt` is the most recent embedded_at across embedded
      // rows; null when no row has ever been embedded.
      // `count(case when ... then 1 end)` returns 0 on an empty tenant
      // (SQLite's count() skips NULL); `sum(case when ... then 1 else 0
      // end)` would return NULL there and surface as a misleading
      // `sql<number>` shape even though the consumer coerces it. Same
      // pattern matches the reports.fiscal aggregate helpers.
      const [counts] = await ctx.db
        .select({
          totalProducts: sql<number>`count(*)`,
          embeddedCount: sql<number>`count(case when ${products.embedding} is not null then 1 end)`,
          staleCount: activeModelId
            ? sql<number>`count(case when ${products.embedding} is not null and coalesce(${products.embeddingModel}, '') <> ${activeModelId} then 1 end)`
            : sql<number>`0`,
          lastEmbeddedAt: sql<string | null>`max(${products.embeddedAt})`,
        })
        .from(products)
        .where(eq(products.tenantId, ctx.tenantId))
        .all();

      const totalProducts = Number(counts?.totalProducts ?? 0);
      const embeddedCount = Number(counts?.embeddedCount ?? 0);
      const staleCount = Number(counts?.staleCount ?? 0);
      const unembeddedCount = Math.max(0, totalProducts - embeddedCount);
      const lastEmbeddedAt = counts?.lastEmbeddedAt ?? null;

      // Surface a small sample of the distinct stale model ids so the
      // banner copy can hint "this catalog has rows from text-embedding-3-small"
      // at a glance. Capped at 3; cheap follow-up SELECT only fires when
      // drift is actually present.
      let staleSampleModelIds: string[] = [];
      if (activeModelId && staleCount > 0) {
        const sampleRows = await ctx.db
          .selectDistinct({ embeddingModel: products.embeddingModel })
          .from(products)
          .where(
            and(
              eq(products.tenantId, ctx.tenantId),
              sql`${products.embedding} is not null`,
              sql`coalesce(${products.embeddingModel}, '') <> ${activeModelId}`
            )
          )
          .limit(3)
          .all();
        staleSampleModelIds = sampleRows
          .map(r => r.embeddingModel)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
      }

      if (activeModelId === null) {
        return {
          mode: 'unavailable' as const,
          activeModelId: null,
          totalProducts,
          embeddedCount,
          unembeddedCount,
          staleCount: 0,
          staleSampleModelIds: [],
          lastEmbeddedAt,
        };
      }

      return {
        mode: 'available' as const,
        activeModelId,
        totalProducts,
        embeddedCount,
        unembeddedCount,
        staleCount,
        staleSampleModelIds,
        lastEmbeddedAt,
      };
    }
  ),

  // ENG-068 — gated behind `semantic-search`. The category-suggest
  // path uses the same embedding pipeline; tying the gates together
  // keeps the operator's mental model simple ("turn on smart search,
  // get all the smart-search features").
  suggestCategory: managerOrAdminProcedureWithModule('semantic-search')
    .input(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const candidates = await ctx.db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(eq(categories.tenantId, ctx.tenantId))
        .all();
      const suggestion = await suggestProductCategory(
        ctx.db,
        ctx.tenantId,
        { name: input.name, description: input.description ?? null },
        candidates
      );
      if (!suggestion) return { ok: false as const, suggestion: null };
      return { ok: true as const, suggestion };
    }),
};
