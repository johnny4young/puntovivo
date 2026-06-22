/**
 * Orders tRPC Router (ENG-178 split).
 *
 * Re-assembles the flat router so `orders.list`/`getById`/`create`/`void`
 * are preserved.
 *
 * @module trpc/routers/orders
 */
import { router } from '../../init.js';
import { ordersQueryProcedures } from './queries.js';
import { ordersMutationProcedures } from './mutations.js';

export const ordersRouter = router({
  ...ordersQueryProcedures,
  ...ordersMutationProcedures,
});
