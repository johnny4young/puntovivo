import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TRPCError } from '@trpc/server';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { ServerErrorWithCode } from '../../lib/errorCodes.js';

import { reserveAiBudget, settleAiBudget } from './budget.js';
import { writeAISettings } from './client.js';

const directory = mkdtempSync(join(tmpdir(), 'puntovivo-ai-budget-'));
const dbPath = join(directory, 'budget.db');
const tenantId = nanoid();
const otherTenantId = nanoid();
let server: PuntovivoServer;
let peerNative: Database.Database;

const audit = {
  tenantId,
  siteId: null,
  userId: null,
  feature: 'completeTest',
  providerId: 'anthropic',
  modelId: 'fake-model',
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.25,
  costState: 'estimated' as const,
  durationMs: 10,
  errorCode: null,
};

beforeAll(async () => {
  server = await createServer({ dbPath, verbose: false });
  const now = new Date().toISOString();
  await getDatabase()
    .insert(schema.tenants)
    .values({
      id: tenantId,
      name: 'Budget tenant',
      slug: `budget-${tenantId}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
  await getDatabase()
    .insert(schema.tenants)
    .values({
      id: otherTenantId,
      name: 'Other budget tenant',
      slug: `budget-${otherTenantId}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
  peerNative = new Database(dbPath);
  peerNative.pragma('busy_timeout = 0');
  peerNative.pragma('foreign_keys = ON');
});

afterAll(async () => {
  peerNative?.close();
  if (server) await server.close();
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  const db = getDatabase();
  await db.delete(schema.aiBudgetReservations).run();
  await db.delete(schema.aiAuditLog).run();
  await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
  await writeAISettings(db, otherTenantId, { enabled: true, monthlyBudgetUsd: 1 });
});

function expectBudgetDenied(action: () => unknown): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TRPCError);
  expect((caught as TRPCError).cause).toBeInstanceOf(ServerErrorWithCode);
  expect(((caught as TRPCError).cause as ServerErrorWithCode).errorCode).toBe('AI_BUDGET_EXCEEDED');
}

describe('durable AI budget admission', () => {
  it('takes the cross-connection writer lock before reading admission state', () => {
    const db = getDatabase();
    const transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce((callback, config) =>
      transaction(tx => {
        expect(config?.behavior).toBe('immediate');
        expect(() => peerNative.exec('BEGIN IMMEDIATE')).toThrow(/locked/);
        expect(peerNative.inTransaction).toBe(false);
        return callback(tx);
      }, config)
    );
    try {
      const admission = reserveAiBudget(db, tenantId);
      expectBudgetDenied(() => reserveAiBudget(drizzle(peerNative, { schema }), tenantId));
      expect(db.select().from(schema.aiBudgetReservations).all()).toMatchObject([
        { id: admission.id, tenantId, state: 'pending' },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('retains unknown holds and their original audit across a connection restart', () => {
    const db = getDatabase();
    const reservation = reserveAiBudget(db, tenantId);
    const result = settleAiBudget(
      db,
      reservation,
      {
        ...audit,
        costState: 'unknown',
        costUsd: 0,
        errorCode: 'AI_PROVIDER_ERROR',
      },
      true
    );
    const originalAudit = db.select().from(schema.aiAuditLog).all();
    peerNative.close();
    peerNative = new Database(dbPath);
    peerNative.pragma('foreign_keys = ON');
    peerNative.pragma('busy_timeout = 0');
    const peer = drizzle(peerNative, { schema });
    expect(peer.select().from(schema.aiBudgetReservations).all()).toMatchObject([
      { id: reservation.id, tenantId, state: 'unknown', auditLogId: result.id },
    ]);
    expectBudgetDenied(() => reserveAiBudget(peer, tenantId));
    expect(() => settleAiBudget(peer, reservation, audit, false)).toThrow(
      /cannot be settled twice/
    );
    expect(peer.select().from(schema.aiAuditLog).all()).toEqual(originalAudit);
    expect(peerNative.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(peerNative.pragma('foreign_key_check')).toEqual([]);
  });

  it('does not settle or release a reservation using another tenant or audit owner', () => {
    const db = getDatabase();
    const reservation = reserveAiBudget(db, tenantId);
    expect(() =>
      settleAiBudget(
        db,
        { ...reservation, tenantId: otherTenantId },
        {
          ...audit,
          tenantId: otherTenantId,
        },
        false
      )
    ).toThrow(/across tenants/);
    expect(() =>
      settleAiBudget(db, reservation, { ...audit, tenantId: otherTenantId }, false)
    ).toThrow(/across tenants/);
    expect(db.select().from(schema.aiAuditLog).all()).toEqual([]);
    expect(db.select().from(schema.aiBudgetReservations).all()).toMatchObject([
      { id: reservation.id, tenantId, state: 'pending' },
    ]);
    const independent = reserveAiBudget(drizzle(peerNative, { schema }), otherTenantId);
    expect(independent.tenantId).toBe(otherTenantId);
    settleAiBudget(db, reservation, audit, false);
    expect(db.select().from(schema.aiBudgetReservations).all()).toMatchObject([
      { id: independent.id, tenantId: otherTenantId, state: 'pending' },
    ]);
  });

  it('blocks a historical unknown call even without a reservation', () => {
    const db = getDatabase();
    db.insert(schema.aiAuditLog)
      .values({
        ...audit,
        id: nanoid(),
        costState: 'unknown',
        costUsd: 0,
        createdAt: new Date().toISOString(),
      })
      .run();
    expectBudgetDenied(() => reserveAiBudget(db, tenantId));
    expect(db.select().from(schema.aiBudgetReservations).all()).toEqual([]);
    expect(db.select().from(schema.aiAuditLog).all()).toHaveLength(1);
    expect(reserveAiBudget(db, otherTenantId).tenantId).toBe(otherTenantId);
  });

  it('does not grant new budget after settling a cost at the monthly limit', () => {
    const db = getDatabase();
    const reservation = reserveAiBudget(db, tenantId);
    settleAiBudget(db, reservation, { ...audit, costUsd: 1 }, false);
    expect(db.select().from(schema.aiBudgetReservations).all()).toEqual([]);
    expectBudgetDenied(() => reserveAiBudget(drizzle(peerNative, { schema }), tenantId));
    expect(db.select().from(schema.aiAuditLog).all()).toMatchObject([{ costUsd: 1 }]);
  });

  it('keeps the admission month and audit timestamp together across month rollover', async () => {
    const db = getDatabase();
    const pinned = new Date(2026, 8, 30, 23, 59, 59, 999);
    const reservation = reserveAiBudget(db, tenantId, pinned);
    const stored = await db.select().from(schema.aiBudgetReservations).all();
    expect(stored).toMatchObject([
      {
        id: reservation.id,
        monthStart: new Date(2026, 8, 1).toISOString(),
        createdAt: pinned.toISOString(),
      },
    ]);
    const settled = settleAiBudget(db, reservation, audit, false);
    const rows = await db.select().from(schema.aiAuditLog).all();
    expect(rows).toMatchObject([{ id: settled.id, createdAt: pinned.toISOString() }]);
  });

  it('serializes admissions across two SQLite connections and releases only after an atomic settlement', async () => {
    const db = getDatabase();
    const peer = drizzle(peerNative, { schema });
    const reservation = reserveAiBudget(db, tenantId);
    expectBudgetDenied(() => reserveAiBudget(peer, tenantId));

    const settled = settleAiBudget(db, reservation, audit, false);
    expect(await db.select().from(schema.aiAuditLog).all()).toMatchObject([{ id: settled.id }]);
    expect(await db.select().from(schema.aiBudgetReservations).all()).toHaveLength(0);
    expect(() => settleAiBudget(db, reservation, audit, false)).toThrow(/cannot be settled twice/);
    expect(await db.select().from(schema.aiAuditLog).all()).toHaveLength(1);

    const next = reserveAiBudget(peer, tenantId);
    expect(next.id).not.toBe(reservation.id);
    await peer
      .delete(schema.aiBudgetReservations)
      .where(eq(schema.aiBudgetReservations.id, next.id));
  });

  it('rolls back both audit and reservation settlement if the audit insert fails', async () => {
    const db = getDatabase();
    const reservation = reserveAiBudget(db, tenantId);
    peerNative.exec(
      "CREATE TRIGGER fail_ai_audit BEFORE INSERT ON ai_audit_log BEGIN SELECT RAISE(ABORT, 'audit write failed'); END"
    );
    try {
      expect(() => settleAiBudget(db, reservation, audit, false)).toThrow(/audit write failed/);
      expect(await db.select().from(schema.aiAuditLog).all()).toHaveLength(0);
      expect(await db.select().from(schema.aiBudgetReservations).all()).toMatchObject([
        { id: reservation.id, state: 'pending' },
      ]);
    } finally {
      peerNative.exec('DROP TRIGGER fail_ai_audit');
    }
    settleAiBudget(db, reservation, audit, false);
    expect(await db.select().from(schema.aiAuditLog).all()).toHaveLength(1);
  });
});
