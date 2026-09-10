/**
 * Real preload → registered IPC → encrypted SQLite authorization regression.
 * Historical outbox fixtures deliberately bypass today's pharmacy writer:
 * protecting only newly written local_only rows would leave old queues exposed.
 * This tests the data boundary, not prescription creation or clinical policy;
 * the separate pharmacy journeys exercise those workflows through their UI.
 */
import type { Page } from '@playwright/test';
import { E2E_USERS } from '../shared/baseline.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import { electronTest as test, expect } from './fixtures.js';
import { signIn, signOut } from './support/journey.js';

interface OutboxFixtureRow {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  status: string;
  payload: {
    id: string;
    customerId: string;
    productId: string;
    authorizedQuantity: number;
    validFrom: string;
    expiresAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface PrivacyFixture {
  customerId: string;
  productId: string;
  rows: OutboxFixtureRow[];
}

async function seedHistoricalOutbox(page: Page): Promise<PrivacyFixture> {
  return page.evaluate(async () => {
    const db = window.db;
    if (!db) throw new Error('The sandboxed Electron database bridge must be available');
    const customerId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    await db.insert('customers', { id: customerId, name: 'IPC privacy fixture patient' });
    await db.insert('products', {
      id: productId,
      sku: `IPC-PRIVACY-${productId}`,
      name: 'IPC privacy fixture medicine',
    });
    const now = new Date().toISOString();
    const rows = [];
    for (const status of ['local_only', 'queued']) {
      const entityId = crypto.randomUUID();
      const row = {
        id: crypto.randomUUID(),
        entityType: 'pharmacy_prescription_evidence',
        entityId,
        operation: 'create',
        status,
        payload: {
          id: entityId,
          customerId,
          productId,
          authorizedQuantity: 7,
          validFrom: '2026-01-01',
          expiresAt: '2026-01-31',
        },
        createdAt: now,
        updatedAt: now,
      };
      // Only the isolated test tenant receives these synthetic history rows.
      // No SQL connection, token forgery or privileged main-process evaluator.
      await db.insert('sync_outbox', row);
      rows.push(row);
    }
    return { customerId, productId, rows };
  });
}

async function assertAdministratorDiagnostics(page: Page, fixture: PrivacyFixture) {
  const result = await page.evaluate(async ({ rows }) => {
    const db = window.db;
    if (!db) throw new Error('Missing Electron database bridge');
    return {
      all: await db.getAll('sync_outbox'),
      byId: await Promise.all(rows.map(row => db.getById('sync_outbox', row.id))),
      byField: await db.getByField('sync_outbox', 'entityType', 'pharmacy_prescription_evidence'),
      pending: await db.getPendingSyncItems(),
      // Updating no business fields still returns the persisted raw row.
      updated: await db.update('sync_outbox', rows[1]!.id, {}),
    };
  }, fixture);
  const protectedRows = fixture.rows.map(row => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: row.operation,
    payload: row.payload,
    createdAt: row.createdAt,
    // The real background worker may already have attempted the historical
    // queue entry. Its delivery status/timestamp are not immutable evidence;
    // privacy checks must preserve the exact payload without stopping sync.
    status:
      row.status === 'local_only' ? 'local_only' : expect.stringMatching(/^(queued|retrying)$/),
  }));
  for (const row of protectedRows) {
    for (const channel of ['all', 'byId', 'byField'] as const) {
      expect(result[channel], channel).toContainEqual(expect.objectContaining(row));
    }
  }
  expect(result.pending).toContainEqual(expect.objectContaining(protectedRows[1]!));
  expect(result.pending).not.toContainEqual(expect.objectContaining({ id: fixture.rows[0]!.id }));
  expect(result.updated).toMatchObject(protectedRows[1]!);
}

async function assertOperationalReads(page: Page, fixture: PrivacyFixture) {
  const result = await page.evaluate(async ({ customerId, productId }) => {
    if (!window.db || !window.sync) throw new Error('Missing Electron operational bridge');
    return {
      customer: await window.db.getById('customers', customerId),
      product: await window.db.getById('products', productId),
      count: await window.db.countByTenant('sync_outbox'),
      status: await window.sync.getStatus(),
    };
  }, fixture);
  expect(result.customer).toMatchObject({
    id: fixture.customerId,
    name: 'IPC privacy fixture patient',
  });
  expect(result.product).toMatchObject({
    id: fixture.productId,
    name: 'IPC privacy fixture medicine',
  });
  expect(result.count).toBeGreaterThanOrEqual(2);
  expect(Object.keys(result.status).sort()).toEqual([
    'conflicts',
    'isOnline',
    'lastSync',
    'pendingItems',
  ]);
  expect(result.status.pendingItems).toBeGreaterThanOrEqual(1);
}

test('raw pharmacy outbox history remains admin-only across real Electron role handoffs', async ({
  page,
}) => {
  const tracker = attachClientIssueTracker(page);
  const admin = E2E_USERS.find(user => user.role === 'admin');
  if (!admin) throw new Error('The isolated baseline must provide its admin');
  await signIn(page, admin.email);
  const fixture = await seedHistoricalOutbox(page);
  await assertAdministratorDiagnostics(page, fixture);
  await assertOperationalReads(page, fixture);

  for (const actor of E2E_USERS.filter(user => user.role !== 'admin')) {
    await test.step(`${actor.role}: role-safe summaries without raw payloads`, async () => {
      await signOut(page);
      await signIn(page, actor.email);
      await page.reload();
      await expect(
        page.locator('header').getByRole('button', { name: /^open user menu for /i })
      ).toBeVisible();
      const results = await page.evaluate(async ({ rows }) => {
        const db = window.db;
        if (!db) throw new Error('Missing Electron database bridge');
        const attempts: Array<[string, () => Promise<unknown>]> = [
          ['getAll', () => db.getAll('sync_outbox')],
          ['getById/local_only', () => db.getById('sync_outbox', rows[0]!.id)],
          ['getById/queued', () => db.getById('sync_outbox', rows[1]!.id)],
          [
            'getByField',
            () => db.getByField('sync_outbox', 'entityType', 'pharmacy_prescription_evidence'),
          ],
          ['getPendingSyncItems', () => db.getPendingSyncItems()],
          ['update/local_only', () => db.update('sync_outbox', rows[0]!.id, {})],
          ['update/queued', () => db.update('sync_outbox', rows[1]!.id, {})],
          ['insert', () => db.insert('sync_outbox', { ...rows[0]!, id: crypto.randomUUID() })],
        ];
        const results = [];
        for (const [channel, invoke] of attempts) {
          try {
            await invoke();
            results.push({ channel, outcome: 'unexpectedly allowed' });
          } catch (error) {
            results.push({
              channel,
              outcome: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return results;
      }, fixture);
      expect(results).toHaveLength(8);
      for (const result of results) {
        expect(result.outcome, `${actor.role} ${result.channel}`).toBe('SESSION_ROLE_FORBIDDEN');
      }
      await assertOperationalReads(page, fixture);
      await expect(page.locator('body')).not.toContainText('SESSION_ROLE_FORBIDDEN');
    });
  }

  await signOut(page);
  await signIn(page, admin.email);
  // Confirm the protected rows were neither hidden from admins nor mutated by
  // rejected calls, and survive reload/session re-registration unchanged.
  await assertAdministratorDiagnostics(page, fixture);
  await expectNoClientIssues(tracker);
});
