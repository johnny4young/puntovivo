/**
 * Raw pharmacy history must not become a renderer capability for any role.
 * Seed historical rows before launch in the isolated SQLCipher fixture; never
 * add a privileged renderer API to replace the capability under test.
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { E2E_USERS } from '../shared/baseline.js';
import { attachClientIssueTracker, expectNoClientIssues } from '../web/support/app.js';
import {
  electronTest,
  expect,
  createIsolatedUserDataDir,
  ELECTRON_E2E_DB_KEY,
} from './fixtures.js';
import { signIn, signOut } from './support/journey.js';

const historicalRows = ['local_only', 'queued'].map(status => ({
  id: `ipc-privacy-history-${status}`,
  status,
  payload: {
    id: `ipc-privacy-evidence-${status}`,
    customerId: 'ipc-privacy-fixture-patient',
    productId: 'ipc-privacy-fixture-medicine',
    authorizedQuantity: 7,
    validFrom: '2026-01-01',
    expiresAt: '2026-01-31',
  },
}));

function openFixture(userDataDir: string) {
  const db = new Database(join(userDataDir, 'data', 'local.db'));
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${ELECTRON_E2E_DB_KEY}'"`);
  return db;
}

const test = electronTest.extend({
  userDataDir: async ({ emptyInstallation }, use, testInfo) => {
    const dir = createIsolatedUserDataDir(testInfo.title, emptyInstallation);
    const db = openFixture(dir);
    try {
      const admin = db
        .prepare('SELECT tenant_id FROM users WHERE email = ?')
        .get('e2e.admin@local.test') as { tenant_id: string } | undefined;
      if (!admin) throw new Error('Missing isolated admin fixture');
      const insert = db.prepare(`INSERT INTO sync_outbox
        (id, tenant_id, entity_type, entity_id, operation, status, payload, created_at, updated_at)
        VALUES (?, ?, 'pharmacy_prescription_evidence', ?, 'create', ?, ?, ?, ?)`);
      // Drizzle supplies these timestamps in application code, not SQL defaults.
      const createdAt = new Date().toISOString();
      for (const row of historicalRows) {
        insert.run(
          row.id,
          admin.tenant_id,
          row.payload.id,
          row.status,
          JSON.stringify(row.payload),
          createdAt,
          createdAt
        );
      }
    } finally {
      db.close();
    }
    await use(dir);
  },
});

test('raw pharmacy history is unavailable to every Electron role while safe sync summaries work', async ({
  page,
  userDataDir,
}) => {
  const tracker = attachClientIssueTracker(page);
  for (const [index, actor] of E2E_USERS.entries()) {
    await test.step(`${actor.role}: no raw aliases after login and reload`, async () => {
      if (index > 0) await signOut(page);
      await signIn(page, actor.email);
      await page.reload();
      await expect(
        page.locator('header').getByRole('button', { name: /^open user menu for /i })
      ).toBeVisible();
      const result = await page.evaluate(async () => {
        if (!window.api || !window.sync) throw new Error('Missing retained operational bridge');
        return {
          rawGlobal: 'db' in window,
          rawNested: 'db' in window.api,
          status: await window.sync.getStatus(),
          hasSession: typeof window.api.session.register === 'function',
          hasNative: typeof window.api.openCustomerDisplay === 'function',
        };
      });
      expect(result.rawGlobal).toBe(false);
      expect(result.rawNested).toBe(false);
      expect(result.hasSession).toBe(true);
      expect(result.hasNative).toBe(true);
      expect(Object.keys(result.status).sort()).toEqual([
        'conflicts',
        'isOnline',
        'lastSync',
        'pendingItems',
      ]);
      expect(result.status.pendingItems).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(result)).not.toContain('ipc-privacy-fixture-patient');
    });
  }
  // The data still exists: removal of the capability must not masquerade as
  // protection by deleting historical rows. Background retries may change the
  // queued status, but never its payload or terminal local_only disposition.
  const db = openFixture(userDataDir);
  try {
    for (const row of historicalRows) {
      const actual = db
        .prepare('SELECT status, payload FROM sync_outbox WHERE id = ?')
        .get(row.id) as { status: string; payload: string } | undefined;
      expect(actual).toBeDefined();
      expect(JSON.parse(actual!.payload)).toEqual(row.payload);
      if (row.status === 'local_only') expect(actual!.status).toBe('local_only');
    }
  } finally {
    db.close();
  }
  await signOut(page);
  await expectNoClientIssues(tracker);
});
