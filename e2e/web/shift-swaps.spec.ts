import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import {
  assertShiftSwapJourneyDiagnostics,
  runShiftSwapJourney,
} from '../shared/shift-swap-journey';
import { attachClientIssueTracker, E2E_PASSWORD, login } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

test('three actors exchange exact published shifts and preserve immutable lineage', async ({
  page,
}, info) => {
  const scenario = seedSurfaceGateScenario(`shift-swap-${info.parallelIndex}-${Date.now()}`, {});
  const tracker = attachClientIssueTracker(page);
  await login(page, { ...scenario.admin, defaultPath: '/company' });
  const result = await runShiftSwapJourney(page, {
    navigate: route => page.goto(route),
    signIn: email =>
      login(page, {
        email,
        password: E2E_PASSWORD,
        defaultPath: email.includes('.cashier.') ? '/sales' : '/dashboard',
      }),
    signInAdmin: () => login(page, { ...scenario.admin, defaultPath: '/company' }),
    screenshot: name => page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true }),
  });
  const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'), {
    readonly: true,
  });
  try {
    const swap = db
      .prepare(
        `SELECT s.id,s.status,s.version,s.offered_shift_id AS offeredShiftId,
                s.requested_shift_id AS requestedShiftId,
                s.offered_replacement_id AS offeredReplacementId,
                s.requested_replacement_id AS requestedReplacementId
           FROM employee_shift_swaps s
           JOIN users requester ON requester.id=s.requester_id AND requester.tenant_id=s.tenant_id
          WHERE s.tenant_id=? AND requester.email=?`
      )
      .get(scenario.tenantId, result.requester.email) as {
      id: string;
      status: string;
      version: number;
      offeredShiftId: string;
      requestedShiftId: string;
      offeredReplacementId: string;
      requestedReplacementId: string;
    };
    expect(swap).toMatchObject({ status: 'approved', version: 3 });
    expect(swap.offeredReplacementId).toBeTruthy();
    expect(swap.requestedReplacementId).toBeTruthy();
    expect(
      db
        .prepare(
          'SELECT status,version FROM scheduled_shifts WHERE tenant_id=? AND id IN (?,?) ORDER BY id'
        )
        .all(scenario.tenantId, swap.offeredShiftId, swap.requestedShiftId)
    ).toEqual([
      { status: 'cancelled', version: 2 },
      { status: 'cancelled', version: 2 },
    ]);
    const replacements = db
      .prepare(
        `SELECT u.email,s.notes,s.status,s.version
           FROM scheduled_shifts s
           JOIN users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id
          WHERE s.tenant_id=? AND s.id IN (?,?)
          ORDER BY s.notes`
      )
      .all(scenario.tenantId, swap.offeredReplacementId, swap.requestedReplacementId);
    expect(replacements).toEqual([
      {
        email: result.recipient.email,
        notes: result.offeredNotes,
        status: 'scheduled',
        version: 1,
      },
      {
        email: result.requester.email,
        notes: result.requestedNotes,
        status: 'scheduled',
        version: 1,
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT e.status,e.version,e.reason,u.email AS actorEmail
             FROM employee_shift_swap_events e
             JOIN users u ON u.id=e.actor_id AND u.tenant_id=e.tenant_id
            WHERE e.tenant_id=? AND e.request_id=?
            ORDER BY e.version`
        )
        .all(scenario.tenantId, swap.id)
    ).toEqual([
      {
        status: 'requested',
        version: 1,
        reason: result.reason,
        actorEmail: result.requester.email,
      },
      {
        status: 'accepted',
        version: 2,
        reason: null,
        actorEmail: result.recipient.email,
      },
      {
        status: 'approved',
        version: 3,
        reason: null,
        actorEmail: scenario.admin.email,
      },
    ]);
    expect(
      db
        .prepare('SELECT COUNT(*) AS total FROM employee_shift_swap_claims WHERE tenant_id=?')
        .get(scenario.tenantId)
    ).toEqual({ total: 0 });
    const swapOutbox = db
      .prepare(
        "SELECT payload,status FROM sync_outbox WHERE tenant_id=? AND entity_type='employee_shift_swaps' ORDER BY created_at,id"
      )
      .all(scenario.tenantId) as Array<{ payload: string; status: string }>;
    expect(swapOutbox).toHaveLength(3);
    expect(swapOutbox.every(row => row.status === 'local_only')).toBe(true);
    const genericPayloads = JSON.stringify(swapOutbox);
    expect(genericPayloads).not.toContain(result.reason);
    expect(genericPayloads).not.toContain(result.offeredNotes);
    expect(genericPayloads).not.toContain(result.requestedNotes);
    expect(genericPayloads).not.toContain('fingerprint');
  } finally {
    db.close();
  }
  assertShiftSwapJourneyDiagnostics(tracker);
});
