/**
 * MEGA seed: AI audit log + anomaly snoozes so the
 * /co-pilot + AI billing pages have real data.
 *
 * @module db/seed-mega/historical-ai
 */

import { nanoid } from 'nanoid';
import { aiAnomalySnoozes, aiAuditLog } from '../schema.js';
import { laterIso, randomDaysAgoIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalAI {
  aiAuditCount: number;
  snoozesCount: number;
}

const AI_FEATURES = [
  'completeTest',
  'copilot',
  'autoCategorize',
  'embeddings',
  'anomalyDetector',
] as const;

const AI_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
const AI_MODELS = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.1:8b',
} as const;

export async function seedHistoricalAI(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalAI> {
  const { db, clock, tenantId, sites, adminUserId } = ctx;

  const auditRows: Array<typeof aiAuditLog.$inferInsert> = [];
  const snoozeRows: Array<typeof aiAnomalySnoozes.$inferInsert> = [];

  for (let i = 0; i < target.aiAuditLogEntries; i += 1) {
    const feature = AI_FEATURES[i % AI_FEATURES.length]!;
    const provider = AI_PROVIDERS[i % AI_PROVIDERS.length]!;
    const model = AI_MODELS[provider];
    const isFailure = i % 10 === 0;
    const inputTokens = 200 + (i % 5) * 150;
    const outputTokens = isFailure ? 0 : 80 + (i % 5) * 40;
    const costUsd = isFailure
      ? 0
      : Number((inputTokens * 0.00003 + outputTokens * 0.00015).toFixed(6));
    const durationMs = 600 + (i % 7) * 250;
    const site = sites[i % sites.length]!;

    auditRows.push({
      id: nanoid(),
      tenantId,
      siteId: site.id,
      userId: adminUserId,
      feature,
      providerId: provider,
      modelId: model,
      inputTokens,
      outputTokens,
      cacheReadTokens: feature === 'copilot' ? Math.floor(inputTokens * 0.4) : 0,
      cacheWriteTokens: feature === 'copilot' ? Math.floor(inputTokens * 0.1) : 0,
      costUsd,
      durationMs,
      errorCode: isFailure ? 'AI_PROVIDER_TIMEOUT' : null,
      createdAt: randomDaysAgoIso(clock, 0, 30, i),
    });
  }

  for (let i = 0; i < target.aiAnomalySnoozes; i += 1) {
    const cashier = ctx.cashiers[i % (ctx.cashiers.length || 1)] ?? null;
    const snoozedAtIso = randomDaysAgoIso(clock, 0, 2, i);
    snoozeRows.push({
      id: nanoid(),
      tenantId,
      kind: ['voidRate', 'highRefund', 'noSaleSessions'][i % 3]!,
      cashierId: cashier?.id ?? null,
      evidenceRef: i % 2 === 0 ? `synthetic-${i}` : null,
      snoozedUntil: laterIso(snoozedAtIso, 7 * 24 * 60 * 60 * 1000),
      snoozedBy: adminUserId,
      reason: 'Snooze creado por seed mega',
      createdAt: snoozedAtIso,
    });
  }

  if (auditRows.length > 0) {
    await db.insert(aiAuditLog).values(auditRows).run();
  }
  if (snoozeRows.length > 0) {
    await db.insert(aiAnomalySnoozes).values(snoozeRows).run();
  }

  return {
    aiAuditCount: auditRows.length,
    snoozesCount: snoozeRows.length,
  };
}
