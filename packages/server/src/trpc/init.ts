/**
 * tRPC Initialization
 * 
 * Base tRPC configuration for Puntovivo
 */

import { initTRPC } from '@trpc/server';
import { ZodError } from 'zod';
import type { Context } from './context.js';

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
