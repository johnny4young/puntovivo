/**
 * ENG-052b — MEGA seed: login attempts (rate-limit dual-bucket
 * observability). The seed mixes IP and username buckets across
 * different windows so the audit / observability surfaces show
 * realistic data.
 *
 * @module db/seed-mega/historical-auth
 */

import { nanoid } from 'nanoid';
import { loginAttempts } from '../schema.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalAuth {
  count: number;
}

const SAMPLE_IPS = ['10.0.0.5', '10.0.0.12', '192.168.1.34', '203.0.113.99'];
const SAMPLE_EMAILS = [
  'attacker.bot@example.com',
  'forgot.password@demo.co',
  'wrong.cashier@demo.co',
];
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function seedHistoricalAuth(
  ctx: MegaContext,
  target: MegaTarget
): Promise<CreatedHistoricalAuth> {
  const { db, clock } = ctx;
  const rows: Array<typeof loginAttempts.$inferInsert> = [];

  // login_attempts has a unique index on (kind, key). Synthesize a
  // unique key per row by suffixing the seed sequence so the seed
  // doesn't fight the constraint while still producing realistic
  // observability data.
  const seenKeys = new Set<string>();
  const pushRow = (
    row: typeof loginAttempts.$inferInsert
  ) => {
    const composite = `${row.kind}:${row.key}`;
    if (seenKeys.has(composite)) return;
    seenKeys.add(composite);
    rows.push(row);
  };

  // Failed (active) buckets — within the rate-limit window
  for (let i = 0; i < target.loginAttemptsFailed; i += 1) {
    const isIp = i % 2 === 0;
    const firstAt = clock.nowMs - (i * 30_000);
    const expiresAt = firstAt + (isIp ? ONE_HOUR_MS : 15 * FIFTEEN_MIN_MS);
    const baseKey = isIp ? SAMPLE_IPS[i % SAMPLE_IPS.length]! : SAMPLE_EMAILS[i % SAMPLE_EMAILS.length]!;
    pushRow({
      id: nanoid(),
      kind: isIp ? 'ip' : 'username',
      key: `${baseKey}#${i}`,
      count: 3 + (i % 5),
      firstAt,
      expiresAt,
      createdAt: new Date(firstAt).toISOString(),
      updatedAt: new Date(firstAt + 60_000).toISOString(),
    });
  }

  // Successful (already expired) — historical record of recent legitimate logins
  for (let i = 0; i < target.loginAttemptsSuccess; i += 1) {
    const firstAt = clock.nowMs - (i + 1) * 12 * 60 * 60 * 1000;
    const expiresAt = firstAt + ONE_HOUR_MS;
    const baseKey = SAMPLE_IPS[(i + 2) % SAMPLE_IPS.length]!;
    pushRow({
      id: nanoid(),
      kind: 'ip',
      key: `${baseKey}#success-${i}`,
      count: 1,
      firstAt,
      expiresAt,
      createdAt: new Date(firstAt).toISOString(),
      updatedAt: new Date(firstAt).toISOString(),
    });
  }

  for (const row of rows) {
    await db
      .insert(loginAttempts)
      .values(row)
      .onConflictDoUpdate({
        target: [loginAttempts.kind, loginAttempts.key],
        set: {
          count: row.count,
          firstAt: row.firstAt,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      })
      .run();
  }

  return { count: rows.length };
}
