/**
 * Before-round module for the main-thread gate: each launch sells against its
 * own copy of the seeded fixture, so no launch inherits the previous sales.
 *
 * @module scripts/electron-budget-fixture-round
 */

import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default async ({ round }) => {
  const source = process.env.PUNTOVIVO_BUDGET_FIXTURE;
  const workDir = process.env.PUNTOVIVO_BUDGET_WORK_DIR;
  if (!source || !workDir) {
    throw new Error('the fixture round needs PUNTOVIVO_BUDGET_FIXTURE and _WORK_DIR');
  }
  const copy = join(workDir, `fixture-${round}.db`);
  copyFileSync(source, copy);
  if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${copy}-wal`);
  return { env: { DATABASE_URL: copy } };
};
