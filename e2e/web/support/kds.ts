/** SQL observations only: preparation/configuration must be created through the running UI. */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { seedRestaurantServiceScenario } from './db';
export function seedKitchenScenario(seed: string) {
  const scenario = seedRestaurantServiceScenario(seed);
  const db = new Database(join(process.cwd(), 'packages/server/data/local.db'));
  try {
    db.prepare(
      "UPDATE tenants SET settings = json_set(settings, '$.modules.kds', json('true')) WHERE id = ?"
    ).run(scenario.tenantId);
  } finally {
    db.close();
  }
  return scenario;
}
export function readKitchenEvidence(tenantId: string, productId: string) {
  const db = new Database(join(process.cwd(), 'packages/server/data/local.db'), { readonly: true });
  try {
    const tickets = db
      .prepare(
        `SELECT o.id, o.station, o.status, o.version, o.items_json AS snapshot,
      l.id AS lineId, l.status AS lineStatus, l.version AS lineVersion
      FROM kds_orders o JOIN kds_order_lines l ON l.order_id = o.id AND l.tenant_id = o.tenant_id
      WHERE o.tenant_id = ? AND l.product_id = ? ORDER BY o.created_at`
      )
      .all(tenantId, productId) as Array<{
      id: string;
      station: string;
      status: string;
      version: number;
      snapshot: string;
      lineId: string;
      lineStatus: string;
      lineVersion: number;
    }>;
    const events = tickets.length
      ? (db
          .prepare(
            'SELECT kind FROM kds_order_events WHERE tenant_id = ? AND order_id = ? ORDER BY sequence'
          )
          .all(tenantId, tickets[0]!.id) as Array<{ kind: string }>)
      : [];
    return { tickets, events: events.map(event => event.kind) };
  } finally {
    db.close();
  }
}
