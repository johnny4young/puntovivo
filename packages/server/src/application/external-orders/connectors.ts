/** Explicit credential management. The caller retains the generated secret; results contain metadata only. */
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { externalOrderConnectors, type ExternalConnectorRow } from '../../db/schema.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  hasExternalOrderSecretKey,
  sealExternalOrderSecret,
} from '../../services/external-orders/secret-box.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import type {
  CreateExternalConnectorInput,
  UpdateExternalConnectorInput,
} from '../../trpc/schemas/externalOrders.js';
import { assertExternalOrderSite } from './invariants.js';
/** Explicit allowlist prevents ciphertext/secret disclosure when columns evolve. */
export function projectExternalConnector(row: ExternalConnectorRow) {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    adapter: row.adapter,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function finish(
  ctx: CriticalCommandContext,
  tx: DatabaseInstance,
  row: ExternalConnectorRow,
  before: ExternalConnectorRow | null
) {
  const result = projectExternalConnector(row);
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    operationId: ctx.envelope.operationId,
    action: 'external_order.connector',
    resourceType: 'external_order_connector',
    resourceId: row.id,
    before: before ? { version: before.version, enabled: before.enabled } : null,
    after: {
      id: row.id,
      siteId: row.siteId,
      adapter: row.adapter,
      enabled: row.enabled,
      version: row.version,
    },
  });
  ctx.completeInTransaction(tx, result);
  return result;
}
export function createExternalConnector(
  ctx: CriticalCommandContext,
  input: CreateExternalConnectorInput
) {
  if (!hasExternalOrderSecretKey()) externalOrderError('key');
  const id = nanoid(),
    sealedSecret = sealExternalOrderSecret(input.secret, {
      tenantId: ctx.tenantId,
      connectorId: id,
    });
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      assertExternalOrderSite(tx, ctx.tenantId, input.siteId);
      const configured =
        tx
          .select({ value: count() })
          .from(externalOrderConnectors)
          .where(
            and(
              eq(externalOrderConnectors.tenantId, ctx.tenantId),
              eq(externalOrderConnectors.siteId, input.siteId)
            )
          )
          .get()?.value ?? 0;
      if (configured >= 100) externalOrderError('invalid');
      const row = tx
        .insert(externalOrderConnectors)
        .values({
          id,
          tenantId: ctx.tenantId,
          siteId: input.siteId,
          name: input.name,
          adapter: input.adapter,
          sealedSecret,
        })
        .returning()
        .get();
      return finish(ctx, tx, row, null);
    },
    { behavior: 'immediate' }
  );
}
export function updateExternalConnector(
  ctx: CriticalCommandContext,
  input: UpdateExternalConnectorInput
) {
  if (input.secret && !hasExternalOrderSecretKey()) externalOrderError('key');
  const sealedSecret = input.secret
    ? sealExternalOrderSecret(input.secret, { tenantId: ctx.tenantId, connectorId: input.id })
    : undefined;
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      assertExternalOrderSite(tx, ctx.tenantId, input.siteId);
      const scope = and(
        eq(externalOrderConnectors.tenantId, ctx.tenantId),
        eq(externalOrderConnectors.siteId, input.siteId),
        eq(externalOrderConnectors.id, input.id)
      );
      const before = tx.select().from(externalOrderConnectors).where(scope).get();
      if (!before) externalOrderError('missing');
      if (before.version !== input.expectedVersion) externalOrderError('conflict');
      const row = tx
        .update(externalOrderConnectors)
        .set({
          enabled: input.enabled,
          ...(sealedSecret ? { sealedSecret } : {}),
          version: before.version + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(and(scope, eq(externalOrderConnectors.version, before.version)))
        .returning()
        .get();
      if (!row) externalOrderError('conflict');
      return finish(ctx, tx, row, before);
    },
    { behavior: 'immediate' }
  );
}
