/**
 * Root tRPC Router
 *
 * Combines all tRPC routers
 */

import { router, publicProcedure } from './init.js';
import { authRouter } from './routers/auth.js';

export const appRouter = router({
  health: router({
    check: publicProcedure.query(() => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'tRPC is working correctly',
      };
    }),
  }),
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
