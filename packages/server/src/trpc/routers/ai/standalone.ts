/**
 * AI router — flat procedures (ENG-178 split).
 *
 * `ai.usage` / `ai.usageByBreakdown` (admin) audit reads, the legacy
 * `ai.extractInvoiceLines` + `ai.matchInvoiceLines` invoice surfaces, the
 * `ai.transcribeAudio` + `ai.parseCartCommand` voice flows, and the
 * `ai.completeTest` end-to-end smoke. Spread into the router barrel.
 *
 * @module trpc/routers/ai/standalone
 */

import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  cashierManagerOrAdminProcedureWithModule,
  managerOrAdminProcedureWithModule,
} from '../../middleware/modules.js';
import {
  byBreakdown,
  completeAI,
  listUsage,
} from '../../../services/ai/index.js';
import {
  extractInvoiceFromImage,
  matchInvoiceLinesToProducts,
} from '../../../services/ai/vision/index.js';
import {
  parseVoiceCartCommand,
  transcribeAudio,
} from '../../../services/ai/voice/index.js';
import { requireAiQuotaAvailable } from '../../../services/ai/quotas.js';
import { aiBreakdownInput, aiUsageInput } from '../../schemas/ai.js';
import {
  extractInvoiceLinesInput,
  matchInvoiceLinesInput,
} from '../../schemas/ai-vision.js';
import {
  parseCartCommandInput,
  transcribeAudioInput,
} from '../../schemas/ai-voice.js';

export const standaloneProcedures = {
  usage: adminProcedure.input(aiUsageInput).query(async ({ ctx, input }) => {
    return listUsage(ctx.db, ctx.tenantId, {
      limit: input.limit ?? 50,
      cursor: input.cursor,
    });
  }),

  usageByBreakdown: adminProcedure
    .input(aiBreakdownInput)
    .query(async ({ ctx, input }) => {
      return byBreakdown(ctx.db, ctx.tenantId, input.scope, {
        from: input.from ? new Date(input.from) : undefined,
        to: input.to ? new Date(input.to) : undefined,
      });
    }),

  /**
   * ENG-040a — Provider-invoice OCR. Manager/admin uploads an invoice
   * photo; the configured vision provider extracts a structured
   * projection (supplier, lines, totals) used by the Purchases page to
   * pre-fill the cart. Slice 1 returns the projection only; line-to-
   * product mapping lands in slice 1b.
   */
  extractInvoiceLines: managerOrAdminProcedure
    .input(extractInvoiceLinesInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id ?? null;
      // ENG-102 — legacy OCR still writes `feature: invoiceOcr`
      // audit rows, so it must share the same per-site quota gate as
      // the newer `ai.invoiceOcr.extract` mutation.
      if (ctx.siteId) {
        await requireAiQuotaAvailable({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          feature: 'invoiceOcr',
        });
      }
      const result = await extractInvoiceFromImage(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId,
        },
        {
          imageBase64: input.imageBase64,
          mimeType: input.mimeType,
        }
      );
      return {
        invoice: result.invoice,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        provider: result.provider,
        model: result.model,
        auditLogId: result.auditLogId,
      };
    }),

  /**
   * ENG-040 slice 1b — match OCR-extracted invoice lines to existing
   * products. Returns top-1 product per line above the shared cosine
   * floor; lines below land as `product: null` so the modal can fall
   * back to the manual picker. Gated behind the `semantic-search`
   * module (mirrors `products.semanticSearch`); when AI is disabled or
   * the tenant has no embeddings yet the procedure returns
   * `mode: 'unavailable'` instead of throwing, so the modal can render
   * a helpful hint instead of an error toast.
   */
  matchInvoiceLines: managerOrAdminProcedureWithModule('semantic-search')
    .input(matchInvoiceLinesInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id ?? null;
      return matchInvoiceLinesToProducts(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId,
        },
        input.lines
      );
    }),

  /**
   * ENG-040c slice 1 — Whisper-style audio transcription.
   *
   * ENG-040c slice 3 widened the gate from `managerOrAdminProcedure`
   * to `cashierManagerOrAdminProcedureWithModule('semantic-search')`
   * because the primary consumer is the cashier-driven voice cart
   * command flow (modal lives in `features/voice/`). The role floor
   * stays explicit so a future read-only role cannot trigger
   * billable AI calls. The `monthlyBudgetUsd` kill switch remains
   * the master abuse defense; the audit log stamps `ctx.user.id`
   * so every call is traceable. Audio over 10 MB raw is rejected
   * at the service layer; providers that lack a
   * `transcriptionModel` (Anthropic / Ollama today) surface
   * `AI_VOICE_NOT_AVAILABLE`.
   */
  transcribeAudio: cashierManagerOrAdminProcedureWithModule('semantic-search')
    .input(transcribeAudioInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id ?? null;
      const result = await transcribeAudio(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId,
        },
        {
          audioBase64: input.audioBase64,
          mimeType: input.mimeType,
        }
      );
      return {
        transcript: result.transcript,
        language: result.language,
        audioDurationSeconds: result.audioDurationSeconds,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        provider: result.provider,
        model: result.model,
        auditLogId: result.auditLogId,
      };
    }),

  /**
   * ENG-040c slice 3 — Voice cart command parser. Takes a transcript
   * (typically produced by `ai.transcribeAudio`) and extracts a
   * bounded ADD-only set of cart actions via `generateObject`, then
   * resolves each parsed `productHint` to a real catalog row via the
   * ENG-033 embeddings stack.
   *
   * Returns one of two shapes:
   *   - `mode: 'parsed'` with `matches[]` — each entry carries a
   *     `productHint`, the (possibly null) parsed `quantity`, and
   *     either a hydrated product summary or `null` for hints below
   *     the cosine floor.
   *   - `mode: 'unrecognized'` — the parser returned zero items.
   *     The `reason` field carries an operator-readable hint the
   *     modal can render inline.
   *
   * Gated by `cashierManagerOrAdminProcedureWithModule('semantic-search')`
   * because the product resolution step depends on tenant embeddings
   * and the primary consumer is the cashier voice modal. The role
   * floor stays explicit so a future read-only role cannot trigger
   * billable AI calls. The monthly budget guard short-circuits
   * before any provider call; the audit log captures one row per
   * call regardless of outcome.
   */
  parseCartCommand: cashierManagerOrAdminProcedureWithModule('semantic-search')
    .input(parseCartCommandInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id ?? null;
      return parseVoiceCartCommand(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId,
        },
        { transcript: input.transcript }
      );
    }),

  /**
   * End-to-end smoke. Sends a fixed prompt, persists the audit log
   * row, returns the model output. Backs the AI Settings card's
   * "Test connection" button.
   */
  completeTest: adminProcedure.mutation(async ({ ctx }) => {
    // adminProcedure → tenantProcedure → protectedProcedure rejects
    // unauthenticated callers, but the middleware-chain narrowing
    // does not propagate to this handler's ctx type. Defensive guard
    // keeps TypeScript happy and produces a clearer 500 if the chain
    // is ever rewired.
    const userId = ctx.user?.id ?? null;
    const result = await completeAI(
      {
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId,
      },
      {
        feature: 'completeTest',
        system:
          'You are the connection-test endpoint of the Puntovivo POS. Reply with a one-line confirmation.',
        prompt: 'Reply with the single word: pong',
        maxOutputTokens: 32,
      }
    );
    return {
      text: result.text,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      provider: result.provider,
      model: result.model,
    };
  }),
};
