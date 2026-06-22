/**
 * Auth tRPC Router (ENG-178 split).
 *
 * Re-assembles the flat router so all 7 paths (`auth.login` … `auth.registerDevice`)
 * are preserved; the public/protected boundary lives on each procedure's builder.
 *
 * @module trpc/routers/auth
 */
import { router } from '../../init.js';
import { authQueryProcedures } from './queries.js';
import { authMutationProcedures } from './mutations.js';

export const authRouter = router({
  ...authQueryProcedures,
  ...authMutationProcedures,
});
