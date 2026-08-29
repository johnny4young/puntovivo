import { getCompanionSnapshot } from '../../services/companion/snapshot.js';
import { router } from '../init.js';
import { createModuleGuard } from '../middleware/modules.js';
import { companionReadProcedure } from '../middleware/roles.js';
import { companionSnapshotInput, companionSnapshotOutput } from '../schemas/companion.js';

/** Viewer-safe, read-only API for the installable Companion surface. */
export const companionRouter = router({
  snapshot: companionReadProcedure
    .use(createModuleGuard('companion'))
    .input(companionSnapshotInput)
    .output(companionSnapshotOutput)
    .query(({ ctx, input }) =>
      getCompanionSnapshot(ctx.db, {
        tenantId: ctx.tenantId,
        date: input.date,
      })
    ),
});

export type CompanionRouter = typeof companionRouter;
