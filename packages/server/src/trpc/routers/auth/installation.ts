import { publicProcedure } from '../../init.js';
import { rateLimitFor } from '../../middleware/procedureRateLimit.js';
import { completeInstallationInput } from '../../schemas/installation.js';
import { assertInstallationSetupAccess } from '../../../security/installation-access.js';

/** Installation-local exception: no tenant exists yet; capability claim creates one exactly once. */
export const installationProcedures = {
  setupStatus: publicProcedure.query(({ ctx }) => {
    ctx.res.header('cache-control', 'no-store');
    return ctx.req.server.installationSetup.getStatus();
  }),
  completeSetup: publicProcedure
    .use(rateLimitFor({ name: 'auth.completeSetup', max: 10, windowMs: 60_000, keyBy: ['ip'] }))
    .use(({ ctx, next }) => {
      assertInstallationSetupAccess(ctx.req);
      ctx.res.header('cache-control', 'no-store');
      return next();
    })
    .input(completeInstallationInput)
    .mutation(({ ctx, input }) => ctx.req.server.installationSetup.complete(input)),
};
