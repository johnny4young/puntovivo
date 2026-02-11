/**
 * Root tRPC Router
 * 
 * Combines all tRPC routers
 */

import { router, publicProcedure } from './init.js';

// Health check procedure for testing
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
});

export type AppRouter = typeof appRouter;
