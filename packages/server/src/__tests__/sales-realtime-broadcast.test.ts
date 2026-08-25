/**
 * `broadcastSaleCompleted` contract.
 *
 * The companion ticker is fed by this post-commit broadcast, and every
 * connected client of the tenant receives it — so the payload must
 * carry what a ticker renders and nothing else (no customer identity,
 * no line detail), it must be tenant-scoped, and a failure must never
 * escape into the caller: the sale is already committed.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  broadcastSaleCompleted,
  broadcastSaleRetracted,
} from '../application/sales/fiscalPostHook.js';
import type { CompleteSaleContext } from '../application/sales/types.js';

function buildCtx(
  overrides: Partial<CompleteSaleContext> = {}
): CompleteSaleContext & { sse: { broadcast: ReturnType<typeof vi.fn> } | null } {
  return {
    db: {} as CompleteSaleContext['db'],
    tenantId: 'tenant-1',
    siteId: 'site-1',
    user: { id: 'user-1', role: 'cashier' },
    sse: { broadcast: vi.fn() },
    ...overrides,
  } as CompleteSaleContext & { sse: { broadcast: ReturnType<typeof vi.fn> } | null };
}

const SALE = {
  id: 'sale-1',
  saleNumber: 'VTA-000123',
  total: 119000,
};

describe('broadcastSaleCompleted', () => {
  it('broadcasts a ticker-shaped payload scoped to the tenant', () => {
    const ctx = buildCtx();
    broadcastSaleCompleted(ctx, SALE);

    expect(ctx.sse!.broadcast).toHaveBeenCalledTimes(1);
    const [eventName, payload, tenantId] = ctx.sse!.broadcast.mock.calls[0]!;
    expect(eventName).toBe('sales.completed');
    expect(tenantId).toBe('tenant-1');
    expect(payload).toMatchObject({
      saleId: 'sale-1',
      saleNumber: 'VTA-000123',
      total: 119000,
      siteId: 'site-1',
    });
    // The COMPLETION instant, not the row's createdAt: a table order
    // opened hours earlier must not read as an hours-old sale.
    const { completedAt } = payload as { completedAt: string };
    expect(Date.now() - Date.parse(completedAt)).toBeLessThan(5_000);
  });

  it('carries no customer identity or line detail', () => {
    const ctx = buildCtx();
    broadcastSaleCompleted(ctx, SALE);
    const payload = ctx.sse!.broadcast.mock.calls[0]![1] as Record<string, unknown>;
    // Everyone on the tenant channel sees this — keep it anonymous.
    expect(Object.keys(payload).sort()).toEqual([
      'completedAt',
      'saleId',
      'saleNumber',
      'siteId',
      'total',
    ]);
  });

  it('is a silent no-op without an SSE manager', () => {
    // Unit tests and internal callers have no Fastify instance.
    expect(() => broadcastSaleCompleted(buildCtx({ sse: null }), SALE)).not.toThrow();
  });

  it('never lets a broadcast failure escape into the committed sale', () => {
    const warn = vi.fn();
    const ctx = buildCtx({
      sse: {
        broadcast: vi.fn(() => {
          throw new Error('transport gone');
        }),
      },
      log: { warn } as unknown as CompleteSaleContext['log'],
    });
    expect(() => broadcastSaleCompleted(ctx, SALE)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('broadcasts a retraction the ticker can act on', () => {
    const ctx = buildCtx();
    broadcastSaleRetracted(ctx, { id: 'sale-1', saleNumber: 'VTA-000123' }, 'voided');

    const [eventName, payload, tenantId] = ctx.sse!.broadcast.mock.calls[0]!;
    expect(eventName).toBe('sales.retracted');
    expect(tenantId).toBe('tenant-1');
    expect(payload).toMatchObject({
      saleId: 'sale-1',
      saleNumber: 'VTA-000123',
      reason: 'voided',
    });
  });

  it('never lets a retraction failure escape either', () => {
    const warn = vi.fn();
    const ctx = buildCtx({
      sse: {
        broadcast: vi.fn(() => {
          throw new Error('transport gone');
        }),
      },
      log: { warn } as unknown as CompleteSaleContext['log'],
    });
    expect(() =>
      broadcastSaleRetracted(ctx, { id: 'sale-1', saleNumber: 'VTA-000123' }, 'returned')
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports a null site when the sale carries none', () => {
    const ctx = buildCtx({ siteId: '' });
    broadcastSaleCompleted(ctx, SALE);
    const payload = ctx.sse!.broadcast.mock.calls[0]![1] as { siteId: string | null };
    expect(payload.siteId).toBeNull();
  });
});

/**
 * Regression: the sale-completion procedures MUST build their
 * application context through `buildLifecycleContext`.
 *
 * Both `create` and `completeDraft` used to assemble the context from
 * an inline literal that never carried the SSE manager, so every
 * realtime hook on those paths — the KDS card as well as the
 * companion ticker — was a silent no-op. A live smoke caught it;
 * nothing in the type system can, because `sse` is optional by design
 * (internal callers legitimately have none).
 */
describe('sale lifecycle context wiring', () => {
  it('never rebuilds the application context inline in the lifecycle router', async () => {
    const source = await readFile(
      new URL('../trpc/routers/sales/lifecycle.ts', import.meta.url),
      'utf8'
    );
    // An inline `db: ctx.db,` literal inside this router means someone
    // re-created the context shape by hand and will drop `sse` again.
    expect(source).not.toMatch(/db: ctx\.db,/);
    expect(source).toContain('buildLifecycleContext(ctx)');
  });

  it('buildLifecycleContext carries the SSE manager off the Fastify instance', async () => {
    const source = await readFile(
      new URL('../trpc/routers/sales/helpers.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain('sse: cc.req?.server?.sse ?? null');
  });
});
