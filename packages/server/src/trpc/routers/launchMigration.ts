/** ENG-123a — Admin-only launch-migration workbench transport. */
import {
  commitLaunchProductImport,
  previewLaunchProductImport,
} from '../../application/launch-migration/index.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import {
  commitLaunchProductImportInput,
  previewLaunchProductImportInput,
} from '../schemas/launchMigration.js';

export const launchMigrationRouter = router({
  previewProducts: adminProcedure
    .input(previewLaunchProductImportInput)
    .mutation(({ ctx, input }) => previewLaunchProductImport({ ...ctx, user: ctx.user! }, input)),
  importProducts: adminProcedure
    .input(commitLaunchProductImportInput)
    .mutation(({ ctx, input }) => commitLaunchProductImport({ ...ctx, user: ctx.user! }, input)),
});
