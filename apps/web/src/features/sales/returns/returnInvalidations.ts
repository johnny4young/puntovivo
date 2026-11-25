import { invalidateGroups, SERIAL_INVENTORY_INVALIDATIONS } from '@/lib/invalidateGroups';
import type { trpc } from '@/lib/trpc';

/** Every read a committed return changes: drawer, sales, stock and the approval that it used. */
export function invalidateAfterReturn(utils: ReturnType<typeof trpc.useUtils>) {
  return invalidateGroups(utils, [
    u => u.cashSessions.getActive,
    u => u.cashSessions.movements,
    u => u.cashSessions.report,
    u => u.sales.list,
    u => u.sales.summary,
    u => u.sales.getById,
    u => u.sales.returnableToday,
    u => u.dashboard.summary,
    u => u.inventory.listMovements,
    u => u.inventory.listStock,
    u => u.products.list,
    u => u.products.search,
    u => u.managerApprovals.mine,
    ...SERIAL_INVENTORY_INVALIDATIONS,
  ]);
}
