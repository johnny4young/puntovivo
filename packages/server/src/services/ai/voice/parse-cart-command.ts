/**
 * ENG-040c slice 3 — Voice cart-command parser.
 *
 * Takes a transcript produced by `ai.transcribeAudio` (Whisper) and
 * extracts a bounded ADD-only set of cart actions via `generateObject`
 * against the tenant's configured language provider. Each parsed
 * `productHint` is then resolved to a real catalog row via the same
 * embeddings stack semantic search uses (ENG-033) — top-1 above the
 * shared cosine floor, or `null` when the hint is too vague.
 *
 * One `generateObject` call covers the parse step; one `embedTexts`
 * batch call covers all hints; one audit-log row covers the whole
 * pipeline. Both `mode='unrecognized'` (parser returned zero items)
 * and `mode='parsed'` paths still write an audit row so the operator
 * can see voice-cost telemetry per tenant regardless of outcome.
 *
 * @module services/ai/voice/parse-cart-command
 */
import { generateObject } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseInstance } from '../../../db/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { products, unitXProduct, units } from '../../../db/schema.js';

import { currentMonthSpend, recordCall } from '../auditLog.js';
import { toBillableTokenUsage } from '../client.js';
import { resolveAISettings } from '../client.js';
import { getProvider } from '../providers/registry.js';
import type { AIProvider } from '../providers/types.js';
import {
  SEMANTIC_SIMILARITY_FLOOR,
  cosineSimilarity,
  embedTexts,
  loadTenantProductEmbeddings,
} from '../embeddings.js';

/** Bounded transcript size — a 60s burst at average speech density
 *  caps around 150 words. 1000 chars covers that with margin and
 *  bounds parser-prompt cost. */
export const VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS = 1000;

/**
 * Output schema the language model fills via `generateObject`.
 *
 * Bounded to ADD operations only — quantity-update, remove, and
 * clear-cart commands are deferred to a follow-up slice once pilot
 * operators report the patterns they actually use. `quantity` is
 * nullable because Spanish voice commands often omit it ("agrega
 * coca cola"); the UI defaults nulls to 1 on apply.
 *
 * `confidence` is a soft signal the modal can use to color the
 * preview; `reason` carries an operator-readable hint when the
 * parser couldn't extract anything (the procedure surfaces this as
 * `mode='unrecognized'` rather than throwing so the modal can
 * render the hint inline).
 */
export const VoiceCartCommandSchema = z.object({
  items: z
    .array(
      z.object({
        productHint: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Free-text product reference as the cashier spoke it.'),
        quantity: z
          .number()
          .nullable()
          .describe('Quantity stated by the cashier; null if not stated.'),
      })
    )
    .max(50)
    .describe('Add-to-cart actions extracted from the transcript.'),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z
    .string()
    .nullable()
    .describe(
      'Operator-readable hint when items=[]; explains why nothing was extracted.'
    ),
});
export type VoiceCartCommand = z.infer<typeof VoiceCartCommandSchema>;

const SYSTEM_PROMPT =
  'Eres un asistente que interpreta órdenes habladas por un cajero de un punto de venta en español o inglés. ' +
  'Extrae SOLO las acciones de tipo "agregar producto al carrito" y la cantidad. ' +
  'Devuelve null en `quantity` si el cashier no la menciona. ' +
  'NO inventes productos ni cantidades. Si el cashier dice algo que no es una orden de agregar ' +
  '(por ejemplo "buenos días"), devuelve items=[] y un mensaje claro en `reason`. ' +
  'Ejemplos: "agrega dos cocas y un pan" => items=[{productHint:"coca cola", quantity:2},{productHint:"pan", quantity:1}], confidence:"high". ' +
  '"agrega coca cola" => items=[{productHint:"coca cola", quantity:null}], confidence:"high". ' +
  '"hola buenos días" => items=[], reason:"No identifiqué productos", confidence:"low".';

const USER_PROMPT_TEMPLATE =
  'Interpreta esta orden hablada por un cajero y devuelve el resultado en el formato JSON definido por el esquema. Transcripción: ';

/**
 * Shape the modal consumes per matched line. Carries enough to
 * construct a `ProductSearchSelection` on the web side without a
 * second tRPC round-trip; `unitPrice` is the unit's selling price
 * (from `unit_x_product.price`) and `taxRate` flows from the
 * product row.
 */
export interface MatchedCartProduct {
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string | null;
  unitAbbreviation: string | null;
  unitEquivalence: number;
  unitPrice: number;
  taxRate: number;
  stock: number;
  sellByFraction: boolean;
  fractionStep: number | null;
  fractionMinimum: number | null;
  similarity: number;
}

export interface CartCommandMatch {
  productHint: string;
  quantity: number | null;
  product: MatchedCartProduct | null;
}

export type CartCommandResult =
  | {
      mode: 'parsed';
      transcript: string;
      matches: CartCommandMatch[];
      confidence: 'high' | 'medium' | 'low';
      costUsd: number;
      durationMs: number;
      provider: AIProvider['id'];
      model: string;
      auditLogId: string;
    }
  | {
      mode: 'unrecognized';
      transcript: string;
      reason: string;
      costUsd: number;
      durationMs: number;
      provider: AIProvider['id'];
      model: string;
      auditLogId: string;
    };

export interface CartCommandContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
}

export interface CartCommandInput {
  transcript: string;
}

/**
 * Parse a voice transcript into a structured cart-add command + match
 * each productHint to a real catalog row. Throws via
 * `throwServerError` for the gating failures (`AI_DISABLED`,
 * `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`) so the modal can surface
 * the localized error; the empty-items path returns
 * `mode='unrecognized'` (NOT a throw) so the modal can render the
 * parser's reason inline.
 */
export async function parseVoiceCartCommand(
  ctx: CartCommandContext,
  input: CartCommandInput
): Promise<CartCommandResult> {
  const transcript = input.transcript.trim();
  if (transcript.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_COMMAND_UNRECOGNIZED',
      message: 'Transcript is empty',
    });
  }
  if (transcript.length > VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_COMMAND_UNRECOGNIZED',
      message: `Transcript exceeds the ${VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS}-char limit`,
    });
  }

  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_DISABLED',
      message: 'AI features are disabled for this tenant',
    });
  }

  const provider = getProvider(settings.providerId);
  if (!provider.isConfigured()) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Provider ${provider.id} is not configured`,
    });
  }

  if (settings.monthlyBudgetUsd <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: 'AI monthly budget is zero',
    });
  }

  const spent = await currentMonthSpend(ctx.db, ctx.tenantId);
  if (spent >= settings.monthlyBudgetUsd) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: `AI monthly budget exhausted ($${spent.toFixed(4)} of $${settings.monthlyBudgetUsd.toFixed(2)})`,
    });
  }

  const modelId = settings.modelId ?? provider.defaultModelId;
  const startedAt = Date.now();
  const providerOptions = provider.cacheControlForSystemPrompt();

  let parsed: VoiceCartCommand;
  let costUsd = 0;
  try {
    const result = await generateObject({
      model: provider.languageModel(modelId),
      system: SYSTEM_PROMPT,
      schema: VoiceCartCommandSchema,
      prompt: `${USER_PROMPT_TEMPLATE}${JSON.stringify(transcript)}`,
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });
    parsed = result.object;
    const billable = toBillableTokenUsage(result.usage);
    costUsd = provider.pricing.calculateCostUsd(modelId, billable);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : 'Voice parser call failed';
    await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'voiceCartCommand',
      providerId: provider.id,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      durationMs,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message,
      details: { cause: String(error) },
    });
  }

  // Unrecognized path: parser returned zero items. Persist an audit
  // row so the operator can see the (small) parser cost even when the
  // cashier said something that wasn't a command.
  if (parsed.items.length === 0) {
    const durationMs = Date.now() - startedAt;
    const { id: auditLogId } = await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'voiceCartCommand',
      providerId: provider.id,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd,
      durationMs,
      errorCode: null,
    });
    return {
      mode: 'unrecognized',
      transcript,
      reason: parsed.reason ?? 'No identifiqué productos',
      costUsd,
      durationMs,
      provider: provider.id,
      model: modelId,
      auditLogId,
    };
  }

  // Parsed path: resolve every productHint via the embedding stack.
  // If the tenant has no embedded products (catalog never indexed),
  // all matches resolve to null — the modal renders "manual pick"
  // hints inline.
  const embedded = await loadTenantProductEmbeddings(ctx.db, ctx.tenantId);
  const winners: Array<{ productId: string; similarity: number } | null> =
    new Array(parsed.items.length).fill(null);

  if (embedded.length > 0) {
    const hintEmbeds = await embedTexts(
      ctx.db,
      ctx.tenantId,
      parsed.items.map(item => item.productHint)
    );
    if (hintEmbeds !== null) {
      for (let i = 0; i < hintEmbeds.embeddings.length; i += 1) {
        const queryVec = hintEmbeds.embeddings[i]!;
        let best: { productId: string; similarity: number } | null = null;
        for (const row of embedded) {
          const sim = cosineSimilarity(queryVec, row.embedding);
          if (sim < SEMANTIC_SIMILARITY_FLOOR) continue;
          if (best === null || sim > best.similarity) {
            best = { productId: row.productId, similarity: sim };
          }
        }
        winners[i] = best;
      }
    }
  }

  const matchedIds = Array.from(
    new Set(
      winners
        .filter((w): w is { productId: string; similarity: number } => w !== null)
        .map(w => w.productId)
    )
  );
  const summaries =
    matchedIds.length === 0
      ? new Map<string, MatchedCartProduct>()
      : await hydrateCartProducts(ctx.db, ctx.tenantId, matchedIds);

  const matches: CartCommandMatch[] = parsed.items.map((item, idx) => {
    const winner = winners[idx];
    if (!winner) {
      return { productHint: item.productHint, quantity: item.quantity, product: null };
    }
    const summary = summaries.get(winner.productId);
    if (!summary) {
      return { productHint: item.productHint, quantity: item.quantity, product: null };
    }
    return {
      productHint: item.productHint,
      quantity: item.quantity,
      product: { ...summary, similarity: winner.similarity },
    };
  });

  const durationMs = Date.now() - startedAt;
  const { id: auditLogId } = await recordCall(ctx.db, {
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    userId: ctx.userId,
    feature: 'voiceCartCommand',
    providerId: provider.id,
    modelId,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
    durationMs,
    errorCode: null,
  });

  return {
    mode: 'parsed',
    transcript,
    matches,
    confidence: parsed.confidence,
    costUsd,
    durationMs,
    provider: provider.id,
    model: modelId,
    auditLogId,
  };
}

async function hydrateCartProducts(
  db: DatabaseInstance,
  tenantId: string,
  productIds: string[]
): Promise<Map<string, MatchedCartProduct>> {
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      price: products.price,
      taxRate: products.taxRate,
      stock: products.stock,
      sellByFraction: products.sellByFraction,
      fractionStep: products.fractionStep,
      fractionMinimum: products.fractionMinimum,
    })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();

  const unitRows = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(and(eq(units.tenantId, tenantId), inArray(unitXProduct.productId, productIds)))
    .all();

  const unitsByProduct = new Map<string, typeof unitRows>();
  for (const row of unitRows) {
    const bucket = unitsByProduct.get(row.productId) ?? [];
    bucket.push(row);
    unitsByProduct.set(row.productId, bucket);
  }

  const out = new Map<string, MatchedCartProduct>();
  for (const product of productRows) {
    const unitsForProduct = unitsByProduct.get(product.id) ?? [];
    if (unitsForProduct.length === 0) continue;
    const baseUnit =
      unitsForProduct.find(u => u.isBase === true) ?? unitsForProduct[0];
    if (!baseUnit) continue;
    out.set(product.id, {
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      unitId: baseUnit.unitId,
      unitName: baseUnit.unitName,
      unitAbbreviation: baseUnit.unitAbbreviation,
      unitEquivalence: baseUnit.equivalence,
      // unit-specific selling price; falls back to the product's base
      // price when the unit row carries 0 (defensive — seeded data
      // sometimes leaves the unit-level price unfilled).
      unitPrice: baseUnit.price && baseUnit.price > 0 ? baseUnit.price : product.price,
      taxRate: product.taxRate ?? 0,
      stock: product.stock ?? 0,
      sellByFraction: product.sellByFraction ?? false,
      fractionStep: product.fractionStep,
      fractionMinimum: product.fractionMinimum,
      // similarity is supplied by the caller after the cosine pass;
      // placeholder here so the type stays uniform.
      similarity: 0,
    });
  }
  return out;
}
