/**
 * `inventory_balances.reserved` is unused BY DESIGN, and must stay that way
 * until the commit point moves.
 *
 * The review that opened this band read `available = max(on_hand - reserved, 0)`
 * with `reserved` permanently zero and called it an over-report of sellable
 * stock. It is not. Puntovivo debits `on_hand` when a sale row is created,
 * draft or completed alike — `runFreshSale` guards the balance delta only with
 * `if (!row.tracksStock) continue;`, with no status check — and credits it back
 * on discard. `application-sales-discardDraft.test.ts` pins the return leg
 * ("restores stock"), which only makes sense because the forward leg debited.
 *
 * So a suspended ticket's units are already OUT of `on_hand`, in-transit
 * transfer units are already out of the origin's, and a serial held by a draft
 * carries its own `product_serials.status = 'reserved'`. There is nothing left
 * for this column to hold, and `available ≡ on_hand` is accurate.
 *
 * What the column IS, is a trap. Anyone implementing reservations would
 * naturally write it and watch `available` fall — while `on_hand` had ALREADY
 * been debited at draft creation, double-counting the hold. Whoever does that
 * work has to move the commit point first, and this test is what makes them
 * notice.
 *
 * @module __tests__/inventory-reserved-is-unused.test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fg from 'fast-glob';

const SRC = path.resolve(process.cwd(), 'src');

/** Every `reserved:` property assignment outside tests. */
function reservedAssignments(): Array<{ file: string; value: string }> {
  // The schema declaration and the DTO type are not writes; scanning them
  // would only add shapes the rule has to special-case.
  const files = fg.sync('**/*.ts', {
    cwd: SRC,
    ignore: ['**/__tests__/**', '**/*.test.ts', 'db/schema/**', '**/types.ts'],
  });
  const found: Array<{ file: string; value: string }> = [];
  for (const relative of files) {
    const source = readFileSync(path.join(SRC, relative), 'utf8');
    for (const match of source.matchAll(/^\s*reserved:\s*(.+?),?\s*$/gm)) {
      found.push({ file: relative, value: match[1]!.trim().replace(/,$/, '') });
    }
  }
  return found;
}

describe('inventory_balances.reserved', () => {
  const assignments = reservedAssignments();

  it('finds the assignments at all', () => {
    // Guards the guard: a regex that matched nothing would make the assertion
    // below vacuously true, which is the failure mode a source scan invites.
    expect(assignments.length).toBeGreaterThanOrEqual(4);
    expect(assignments.map(entry => entry.file)).toContain(
      path.join('services', 'inventory-balances', 'apply-delta.ts')
    );
  });

  it('is written as a literal zero by every writer, or read straight back', () => {
    // The two shapes allowed: a writer opening a row at zero, and a read
    // projecting the stored column. Anything else means somebody started
    // holding stock here, and the commit point has to move first — see the
    // module comment above.
    const READ_BACK = new Set(['inventoryBalances.reserved', 'reservedSql']);
    for (const entry of assignments) {
      const isZeroWrite = entry.value === '0';
      const isReadBack = READ_BACK.has(entry.value);
      expect(
        isZeroWrite || isReadBack,
        `${entry.file} assigns reserved: ${entry.value} — see the module comment`
      ).toBe(true);
    }
    // And at least one real writer, so the rule is not enforced over an empty
    // set of write sites.
    expect(assignments.some(entry => entry.value === '0')).toBe(true);
  });

  it('has no writer that increments or decrements it', () => {
    const files = fg.sync('**/*.ts', {
      cwd: SRC,
      ignore: ['**/__tests__/**', '**/*.test.ts'],
    });
    const offenders: string[] = [];
    for (const relative of files) {
      const source = readFileSync(path.join(SRC, relative), 'utf8');
      // A set() carrying `reserved` on the balances table, or SQL arithmetic
      // against the column, is the shape a half-built reservation feature
      // takes before anyone notices the double count.
      if (/reserved:\s*sql`/.test(source) || /\breserved\s*[+-]=/.test(source)) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves available identical to on_hand, which is what the SQL says', () => {
    // `available` is only ever computed one way, in
    // trpc/routers/inventory/queries.ts. With reserved pinned at zero by the
    // assertions above, this expression is on_hand — stated here so the
    // relationship is legible without reading the query builder.
    const queries = readFileSync(
      path.join(SRC, 'trpc', 'routers', 'inventory', 'queries.ts'),
      'utf8'
    );
    expect(queries).toContain('max(${onHandSql} - ${reservedSql}, 0)');
    expect(queries).toContain('coalesce(${inventoryBalances.reserved}, 0)');
  });
});
