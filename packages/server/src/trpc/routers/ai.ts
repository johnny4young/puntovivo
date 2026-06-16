/**
 * ENG-030/031 — AI router.
 *
 * Seven procedure groups:
 * - `ai.settings.get` — current AI configuration + provider availability
 *   + this-month spend.
 * - `ai.settings.update` — partial patch on `tenants.settings.ai`.
 *   Rejects setting `providerId` to a notImplemented stub.
 * - `ai.usage` — paginated audit-log read.
 * - `ai.usageByBreakdown` — group-by report (site / user / feature /
 *   provider) for multi-site cost governance.
 * - `ai.completeTest` — fixed "ping" prompt that exercises the full
 *   pipeline so the operator can validate the env var + provider
 *   round-trip without waiting for ENG-031.
 * - `ai.copilot.chat` — manager/admin conversational analytics over a
 *   bounded tenant-scoped snapshot.
 * - `ai.anomalies.list` — manager/admin local-only anomaly detection
 *   for the dashboard tile.
 *
 * @module trpc/routers/ai
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { router } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import {
  cashierManagerOrAdminProcedureWithModule,
  managerOrAdminProcedureWithModule,
} from '../middleware/modules.js';
import {
  ANALYSIS_WINDOW_DAYS,
  byBreakdown,
  completeAI,
  currentMonthSpend,
  detectAnomalies,
  isNotImplemented,
  listProviders,
  listUsage,
  recordCall,
  resolveAISettings,
  runCopilotChat,
  writeAISettings,
} from '../../services/ai/index.js';
import {
  extractInvoiceFromImage,
  matchInvoiceLinesToProducts,
} from '../../services/ai/vision/index.js';
import {
  parseVoiceCartCommand,
  transcribeAudio,
} from '../../services/ai/voice/index.js';
import { getProvider } from '../../services/ai/providers/registry.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  aiBreakdownInput,
  anomalyListInput,
  anomalySnoozeInput,
  copilotChatInput,
  aiUsageInput,
  updateAISettingsInput,
} from '../schemas/ai.js';
import {
  confirmInvoiceDraftInput,
  extractInvoiceOcrInput,
  extractInvoiceLinesInput,
  matchInvoiceLinesInput,
} from '../schemas/ai-vision.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { normalizeColombianInvoice } from '../../services/ai/invoice/normalize-co.js';
import { extractInvoiceWithTextract } from '../../services/ai/invoice/textract.js';
import {
  projectEmptyAiQuotas,
  projectAiQuotas,
  requireAiQuotaAvailable,
} from '../../services/ai/quotas.js';
import { createOcrDraftPurchase } from '../../application/purchases/index.js';
import {
  parseCartCommandInput,
  transcribeAudioInput,
} from '../schemas/ai-voice.js';
import { aiAnomalySnoozes, invoiceUploads, providers, users } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';

function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

async function findProviderIdForInvoice(
  db: DatabaseInstance,
  tenantId: string,
  supplier: { name: string; nit: string | null }
): Promise<string | null> {
  const rows = await db
    .select({ id: providers.id, name: providers.name, taxId: providers.taxId })
    .from(providers)
    .where(and(eq(providers.tenantId, tenantId), eq(providers.isActive, true)))
    .all();
  const targetNit = normalizeTaxId(supplier.nit);
  if (targetNit) {
    const byNit = rows.find(row => normalizeTaxId(row.taxId) === targetNit);
    if (byNit) return byNit.id;
  }

  const supplierName = supplier.name.trim().toLowerCase();
  if (!supplierName) return null;
  const byName = rows.find(row => {
    const candidate = row.name.trim().toLowerCase();
    return candidate === supplierName || supplierName.includes(candidate) || candidate.includes(supplierName);
  });
  return byName?.id ?? null;
}

const settingsRouter = router({
  get: managerOrAdminProcedure.query(async ({ ctx }) => {
    const settings = await resolveAISettings(ctx.db, ctx.tenantId);
    const provider = getProvider(settings.providerId);
    const spend = await currentMonthSpend(ctx.db, ctx.tenantId);
    // ENG-102 — per-site quota projection. When the request has no
    // siteId (admin without an active site) we still return the
    // shape so the UI never branches on undefined; the numbers
    // surface as zero / limit / next-month boundary.
    const quotas = ctx.siteId
      ? await projectAiQuotas({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
        })
      : projectEmptyAiQuotas();
    return {
      enabled: settings.enabled,
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      providerId: provider.id,
      modelId: settings.modelId,
      defaultModelId: provider.defaultModelId,
      effectiveModelId: settings.modelId ?? provider.defaultModelId,
      providerConfigured: provider.isConfigured(),
      currentMonthSpendUsd: spend,
      availableProviders: listProviders(),
      // ENG-040c slice 2 — capability hint for the AI settings UI.
      // True when the active provider implements Whisper-style audio
      // transcription (OpenAI today). The "Probar transcripción"
      // button reads this so it can disable + tooltip on Anthropic /
      // Ollama tenants without firing a server round-trip.
      transcriptionAvailable: typeof provider.transcriptionModel === 'function',
      // ENG-095 / AI Núcleo 2026-05-15 — per-feature opt-in flags
      // consumed by `useAiFeatureFlag` on the web.
      features: settings.features,
      // ENG-102 — monthly per-site quotas for the features that the
      // website draft makes a numeric promise about. The UI renders
      // a progress bar per feature using `used / limit` and surfaces
      // `resetsAt` so the cashier knows when the counter rolls over.
      quotas,
    };
  }),

  update: adminProcedure
    .input(updateAISettingsInput)
    .mutation(async ({ ctx, input }) => {
      // Reject before-the-fact selection of a notImplemented provider
      // so the admin sees a meaningful error rather than a confusing
      // "looks fine" → "first call fails" UX.
      //
      // ENG-040b slice 1 — currently every registered provider is
      // implemented (Anthropic + OpenAI + Ollama), so this branch is
      // dead in CI. Keep the guard in place because the registry
      // contract still permits `NotImplementedProvider` entries; the
      // next provider that lands as a stub (e.g. a future Google /
      // Mistral integration) gets a regression-coverage assertion
      // re-added in `ai-router.test.ts` at the same time as it lands.
      if (input.providerId) {
        const candidate = getProvider(input.providerId);
        if (isNotImplemented(candidate)) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'AI_PROVIDER_ERROR',
            message: `${candidate.id} provider lands with ${candidate.availableInTicket}`,
          });
        }
      }
      await writeAISettings(ctx.db, ctx.tenantId, input);
      return { ok: true as const };
    }),
});

const copilotRouter = router({
  // ENG-068 — gated behind the `copilot` module. The role check
  // (managerOrAdmin) still applies; a manager whose tenant has the
  // module deactivated sees FORBIDDEN with `MODULE_NOT_ACTIVATED`.
  chat: managerOrAdminProcedureWithModule('copilot')
    .input(copilotChatInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.copilot.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'Co-pilot is disabled for this tenant',
        });
      }
      // ENG-102 — per-site monthly quota check fires BEFORE the
      // provider call so a blocked request never writes an audit
      // row. Bypass when the request has no site context (admin
      // without a selected site); the quota is "per site" by
      // definition, so a site-less call has no bucket to charge.
      if (ctx.siteId) {
        await requireAiQuotaAvailable({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          feature: 'copilot',
        });
      }
      const userId = ctx.user?.id ?? null;
      return runCopilotChat(
        {
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId,
        },
        input
      );
    }),
});

/**
 * ENG-032 — anomalies sub-router.
 *
 * `list` returns the four-detector aggregate. `managerOrAdminProcedure`
 * gates out cashiers (already excluded from `/dashboard` at the
 * sidebar level; this is defense-in-depth at the API layer).
 *
 * Behavior contract:
 *   - When `tenants.settings.ai.enabled === false`, return an empty
 *     result without running the detector queries. UX consistency
 *     with `ai.copilot.chat` and `ai.completeTest`: the operator can
 *     flip the master toggle off and every AI surface short-circuits
 *     in the same way.
 *   - When `from > to`, throw BAD_REQUEST. No errorCode (plain Zod
 *     input shape error).
 *   - When `from` / `to` omitted, default window is the last
 *     `ANALYSIS_WINDOW_DAYS` (30) days ending at `now`.
 */
const anomaliesRouter = router({
  // ENG-068 — gated behind the `anomaly-detection` module. Tenant
  // can hide the dashboard tile + drill-down modal without disabling
  // the broader `ai.enabled` flag (e.g. AI Wave 1 chat stays on, but
  // anomaly tile hides for tenants on a basic plan).
  list: managerOrAdminProcedureWithModule('anomaly-detection')
    .input(anomalyListInput)
    .query(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      const now = new Date();
      const computedAt = now.toISOString();

      if (!settings.enabled || settings.features?.anomalies.enabled !== true) {
        return {
          enabled: false,
          alerts: [],
          totalCount: 0,
          severityCounts: { medium: 0, high: 0 } as const,
          kindCounts: {
            ticketsPerHourSpike: 0,
            voidRate: 0,
            refundAmount: 0,
            noSaleSessions: 0,
          } as const,
          computedAt,
        };
      }

      const to = input.to ? new Date(input.to) : now;
      const from = input.from
        ? new Date(input.from)
        : new Date(to.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      if (from.getTime() > to.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'from must be earlier than or equal to to',
        });
      }

      const result = await detectAnomalies(ctx.db, {
        tenantId: ctx.tenantId,
        from,
        to,
      });

      return { ...result, enabled: true, computedAt };
    }),

  /**
   * ENG-047 — silence an anomaly for a chosen window. The dashboard
   * tile + modal call this when the manager has investigated and
   * confirmed an alert is legitimate. Future runs of the detector
   * filter alerts whose `(kind, cashierId, evidenceRef)` matches an
   * unexpired row in `ai_anomaly_snoozes`.
   */
  // ENG-068 — same module gate as `list`. Snooze is meaningless when
  // the surface that would surface the alerts is hidden.
  snooze: managerOrAdminProcedureWithModule('anomaly-detection')
    .input(anomalySnoozeInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id;
      if (!userId) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Snoozing an anomaly requires an authenticated manager',
        });
      }
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.anomalies.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'AI anomaly detection is disabled for this tenant',
        });
      }
      const now = new Date();
      const snoozedUntil = new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
      if (input.cashierId !== null) {
        const cashier = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.cashierId), eq(users.tenantId, ctx.tenantId)))
          .get();
        if (!cashier) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot snooze an anomaly for a cashier outside the active tenant',
          });
        }
      }
      const snoozeId = nanoid();
      await ctx.db.insert(aiAnomalySnoozes).values({
        id: snoozeId,
        tenantId: ctx.tenantId,
        kind: input.kind,
        cashierId: input.cashierId,
        evidenceRef: input.evidenceRef ?? null,
        snoozedUntil: snoozedUntil.toISOString(),
        snoozedBy: userId,
        reason: input.reason ?? null,
        createdAt: now.toISOString(),
      });
      // ENG-095 / AI Núcleo 2026-05-15 — surface anomaly silence on
      // AiConfigPage's audit table so the operator sees who muted what.
      writeAuditLog({
        tx: ctx.db,
        tenantId: ctx.tenantId,
        actorId: userId,
        action: 'ai.anomaly.silenced',
        resourceType: 'ai_feature',
        resourceId: snoozeId,
        metadata: {
          kind: input.kind,
          cashierId: input.cashierId,
          evidenceRef: input.evidenceRef ?? null,
          durationDays: input.durationDays,
          snoozedUntil: snoozedUntil.toISOString(),
          reason: input.reason ?? null,
        },
      });
      return { ok: true as const, snoozedUntil: snoozedUntil.toISOString() };
    }),
});

/**
 * ENG-094 / AI Núcleo 2026-05-15 — `ai.invoiceOcr.{extract,confirm}`.
 *
 * Sits next to the legacy `ai.extractInvoiceLines` mutation (still
 * consumed by the deprecated `InvoiceOcrPreviewModal`). The new
 * surface returns a richer `PurchaseDraft` shape — supplier + NIT +
 * invoice number + per-line confidence + linesSum reconciliation —
 * and writes audit-log rows on every extract + confirm so the
 * AiConfigPage table can replay cost / latency / actor per request.
 */
const invoiceOcrRouter = router({
  extract: managerOrAdminProcedure
    .input(extractInvoiceOcrInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.invoiceOcr.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'Invoice OCR is disabled for this tenant',
        });
      }
      // ENG-102 — per-site monthly quota check fires BEFORE the
      // OCR provider call so a blocked request never writes an
      // audit row. Bypass when the request has no site context.
      if (ctx.siteId) {
        await requireAiQuotaAvailable({
          db: ctx.db,
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          feature: 'invoiceOcr',
        });
      }

      const upload = await ctx.db
        .select()
        .from(invoiceUploads)
        .where(and(eq(invoiceUploads.id, input.uploadId), eq(invoiceUploads.tenantId, ctx.tenantId)))
        .get();

      if (!upload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice upload not found',
        });
      }

      const userId = ctx.user!.id;
      const ocrProvider = settings.features?.invoiceOcr.provider ?? 'textract';
      if (ocrProvider !== 'textract') {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_PROVIDER_ERROR',
          message: `${ocrProvider} invoice OCR provider is not wired yet`,
        });
      }

      const result = await extractInvoiceWithTextract({
        documentBase64: upload.payloadBase64,
        mimeType: upload.mimeType as Parameters<typeof extractInvoiceWithTextract>[0]['mimeType'],
      });

      const { id: aiAuditLogId } = await recordCall(ctx.db, {
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId,
        feature: 'invoiceOcr',
        providerId: result.provider,
        modelId: result.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        errorCode: null,
      });

      const normalized = normalizeColombianInvoice({
        supplierName: result.invoice.supplierName,
        supplierTaxId: result.invoice.supplierTaxId,
        invoiceNumber: result.invoice.invoiceNumber,
        subtotal: result.invoice.subtotal,
        taxAmount: result.invoice.taxAmount,
        lines: result.invoice.lines.map(l => ({ totalLine: l.totalLine })),
      });

      const lineMatches = result.invoice.lines.length
        ? await matchInvoiceLinesToProducts(
            { db: ctx.db, tenantId: ctx.tenantId, siteId: ctx.siteId, userId },
            result.invoice.lines.map(l => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              totalLine: l.totalLine,
            })),
            { bestEffortSkuFallback: true }
          ).catch(() => null)
        : null;

      const matchedLookup = new Map<
        number,
        {
          productId: string | null;
          productName: string | null;
          productSku: string | null;
          unitId: string | null;
          unitName: string | null;
          unitEquivalence: number | null;
          source: 'sku' | 'embedding' | null;
        }
      >();
      if (lineMatches && lineMatches.mode === 'matched') {
        lineMatches.matches.forEach((match, idx) => {
          matchedLookup.set(idx, {
            productId: match.product?.productId ?? null,
            productName: match.product?.productName ?? null,
            productSku: match.product?.productSku ?? null,
            unitId: match.product?.unitId ?? null,
            unitName: match.product?.unitName ?? match.product?.unitAbbreviation ?? null,
            unitEquivalence: match.product?.unitEquivalence ?? null,
            source: match.product ? match.source : null,
          });
        });
      }

      const subtotal = result.invoice.subtotal ?? 0;
      const iva = result.invoice.taxAmount ?? 0;
      const total = result.invoice.total ?? subtotal + iva;
      const linesSum =
        Math.abs(normalized.linesSum + iva - total) <= 100
          ? normalized.linesSum + iva
          : normalized.linesSum;

      const draft = {
        supplier: {
          name: normalized.supplier.name,
          nit: normalized.supplier.nit,
          confidence: result.invoice.supplierName ? 0.92 : 0.55,
        },
        providerId: await findProviderIdForInvoice(ctx.db, ctx.tenantId, normalized.supplier),
        invoiceNumber: {
          value: normalized.invoiceNumber ?? '',
          confidence: result.invoice.invoiceNumber ? 0.9 : 0.5,
        },
        lines: result.invoice.lines.map((line, idx) => {
          const match = matchedLookup.get(idx);
          return {
            description: line.description,
            quantity: line.quantity ?? 1,
            unitPrice: line.unitPrice ?? 0,
            matchedProductId: match?.productId ?? null,
            matchedProductName: match?.productName ?? null,
            matchedProductSku: match?.productSku ?? null,
            unitId: match?.unitId ?? null,
            unitName: match?.unitName ?? null,
            unitEquivalence: match?.unitEquivalence ?? null,
            matchedBy: match?.source ?? null,
            confidence: match?.productId ? 0.88 : 0.7,
          };
        }),
        totals: {
          subtotal,
          iva,
          total,
          linesSum,
        },
        warnings: [] as string[],
        meta: {
          costUsd: result.costUsd,
          latencyMs: result.durationMs,
          provider: result.provider,
        },
        uploadId: upload.id,
        extractAuditId: aiAuditLogId,
      };

      const uploadAuditId = writeAuditLog({
        tx: ctx.db,
        tenantId: ctx.tenantId,
        actorId: userId,
        action: 'ai.invoice_ocr.extract',
        resourceType: 'ai_feature',
        resourceId: upload.id,
        metadata: {
          provider: result.provider,
          costUsd: result.costUsd,
          latencyMs: result.durationMs,
          model: result.model,
          aiAuditLogId,
          payloadHash: upload.payloadHash,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          ivaRate: normalized.ivaRate,
          lineCount: draft.lines.length,
          matchedLineCount: draft.lines.filter(l => l.matchedProductId).length,
        },
      });

      return { ...draft, uploadAuditId };
    }),

  confirm: managerOrAdminProcedure
    .input(confirmInvoiceDraftInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await resolveAISettings(ctx.db, ctx.tenantId);
      if (!settings.enabled || settings.features?.invoiceOcr.enabled !== true) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'AI_DISABLED',
          message: 'Invoice OCR is disabled for this tenant',
        });
      }

      if (Math.abs(input.totals.total - input.totals.linesSum) > 100) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invoice totals do not match the reviewed line totals',
        });
      }

      const upload = await ctx.db
        .select({
          id: invoiceUploads.id,
          payloadHash: invoiceUploads.payloadHash,
          mimeType: invoiceUploads.mimeType,
          sizeBytes: invoiceUploads.sizeBytes,
        })
        .from(invoiceUploads)
        .where(and(eq(invoiceUploads.id, input.uploadId), eq(invoiceUploads.tenantId, ctx.tenantId)))
        .get();

      if (!upload) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invoice upload not found',
        });
      }

      const purchase = await createOcrDraftPurchase({ ...ctx, user: ctx.user! }, {
        providerId: input.providerId,
        items: input.lines.map(line => ({
          productId: line.matchedProductId,
          unitId: line.unitId,
          quantity: line.quantity,
          costPerUnit: line.unitPrice,
        })),
        notes: [
          'OCR invoice draft',
          input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : null,
          input.supplier.name ? `Supplier ${input.supplier.name}` : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' · '),
      });

      const userId = ctx.user!.id;
      writeAuditLog({
        tx: ctx.db,
        tenantId: ctx.tenantId,
        actorId: userId,
        action: 'ai.invoice_ocr.confirm',
        resourceType: 'ai_feature',
        resourceId: input.uploadId,
        metadata: {
          extractAuditId: input.extractAuditId,
          purchaseId: purchase.id,
          purchaseNumber: purchase.purchaseNumber,
          supplierName: input.supplier.name,
          supplierNit: input.supplier.nit,
          invoiceNumber: input.invoiceNumber,
          subtotal: input.totals.subtotal,
          total: input.totals.total,
          linesSum: input.totals.linesSum,
          payloadHash: upload.payloadHash,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          lineCount: input.lines.length,
          matchedLineCount: input.lines.length,
        },
      });
      return { ok: true as const, purchase };
    }),
});

export const aiRouter = router({
  settings: settingsRouter,
  copilot: copilotRouter,
  anomalies: anomaliesRouter,
  invoiceOcr: invoiceOcrRouter,

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
});
