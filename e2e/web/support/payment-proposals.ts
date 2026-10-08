import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { statementKey } from '../../../packages/server/src/services/payments/reconciliation/proposals';

const dbPath = join(process.cwd(), 'packages/server/data/local.db');

export function seedProposals(tenantId: string) {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  const now = new Date().toISOString();
  const proposals = ['approve', 'reject'].map(decision => {
    const id = `e2e-proposal-${decision}-${randomUUID()}`;
    const outboxId = `${id}-outbox`;
    const statement = {
      railId: 'wompi' as const,
      reference: `${id}-provider`,
      providerTransactionId: `${id}-transaction`,
      amount: 123.45,
      currencyCode: 'COP',
      status: 'settled' as const,
      settledAt: now,
      fee: 0,
    };
    return { id, outboxId, statement };
  });
  try {
    db.transaction(() => {
      for (const { id, outboxId, statement } of proposals) {
        db.prepare(
          `INSERT INTO payment_outbox
          (id, tenant_id, rail_id, kind, status, amount, currency_code, reference, payload, created_at, updated_at)
          VALUES (?, ?, 'wompi', 'charge', 'approved', 123.45, 'COP', ?, '{}', ?, ?)`
        ).run(outboxId, tenantId, `${id}-pos`, now, now);
        const evidence = {
          statement,
          recommendedOutboxId: outboxId,
          confidence: 'high',
          explanation: 'Synthetic local fixture, not live provider verification.',
          aiAuditLogId: `${id}-synthetic-audit`,
          candidates: [
            {
              outboxId,
              salePaymentId: null,
              reference: `${id}-pos`,
              providerTransactionId: null,
              amount: 123.45,
              currencyCode: 'COP',
              kind: 'charge',
              status: 'approved',
              createdAt: now,
            },
          ],
        };
        db.prepare(
          `INSERT INTO payment_reconciliation_proposals
          (id, tenant_id, rail_id, statement_key, selected_outbox_id, status, evidence, created_at)
          VALUES (?, ?, 'wompi', ?, ?, 'pending', ?, ?)`
        ).run(id, tenantId, statementKey(statement), outboxId, JSON.stringify(evidence), now);
      }
    }).immediate();
  } finally {
    db.close();
  }
  return proposals;
}

export function readDecision(tenantId: string, id: string, outboxId: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      proposal: db
        .prepare(
          'SELECT status, reviewed_by FROM payment_reconciliation_proposals WHERE tenant_id = ? AND id = ?'
        )
        .get(tenantId, id),
      outbox: db
        .prepare(
          'SELECT status, provider_transaction_id, amount FROM payment_outbox WHERE tenant_id = ? AND id = ?'
        )
        .get(tenantId, outboxId),
      audit: db
        .prepare(
          'SELECT action FROM audit_logs WHERE tenant_id = ? AND resource_id IN (?, ?) ORDER BY action'
        )
        .all(tenantId, id, outboxId),
    };
  } finally {
    db.close();
  }
}
