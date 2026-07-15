/** ENG-123a/ENG-123b — Admin-only launch-migration workbench transport. */
import {
  commitLaunchCustomerBalanceImport,
  commitLaunchCustomerImport,
  commitLaunchProductImport,
  commitLaunchProviderImport,
  previewLaunchCustomerBalanceImport,
  previewLaunchCustomerImport,
  previewLaunchProductImport,
  previewLaunchProviderImport,
} from '../../application/launch-migration/index.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import {
  commitLaunchCustomerBalanceImportInput,
  commitLaunchCustomerImportInput,
  commitLaunchProductImportInput,
  commitLaunchProviderImportInput,
  previewLaunchCustomerBalanceImportInput,
  previewLaunchCustomerImportInput,
  previewLaunchProductImportInput,
  previewLaunchProviderImportInput,
} from '../schemas/launchMigration.js';

export const launchMigrationRouter = router({
  previewProducts: adminProcedure
    .input(previewLaunchProductImportInput)
    .mutation(({ ctx, input }) => previewLaunchProductImport({ ...ctx, user: ctx.user! }, input)),
  importProducts: adminProcedure
    .input(commitLaunchProductImportInput)
    .mutation(({ ctx, input }) => commitLaunchProductImport({ ...ctx, user: ctx.user! }, input)),
  previewCustomers: adminProcedure
    .input(previewLaunchCustomerImportInput)
    .mutation(({ ctx, input }) => previewLaunchCustomerImport({ ...ctx, user: ctx.user! }, input)),
  importCustomers: adminProcedure
    .input(commitLaunchCustomerImportInput)
    .mutation(({ ctx, input }) => commitLaunchCustomerImport({ ...ctx, user: ctx.user! }, input)),
  previewProviders: adminProcedure
    .input(previewLaunchProviderImportInput)
    .mutation(({ ctx, input }) => previewLaunchProviderImport({ ...ctx, user: ctx.user! }, input)),
  importProviders: adminProcedure
    .input(commitLaunchProviderImportInput)
    .mutation(({ ctx, input }) => commitLaunchProviderImport({ ...ctx, user: ctx.user! }, input)),
  previewCustomerBalances: adminProcedure
    .input(previewLaunchCustomerBalanceImportInput)
    .mutation(({ ctx, input }) =>
      previewLaunchCustomerBalanceImport({ ...ctx, user: ctx.user! }, input)
    ),
  importCustomerBalances: adminProcedure
    .input(commitLaunchCustomerBalanceImportInput)
    .mutation(({ ctx, input }) =>
      commitLaunchCustomerBalanceImport({ ...ctx, user: ctx.user! }, input)
    ),
});
