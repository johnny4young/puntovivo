// ENG-179c — API/DTO layer of the former monolithic `types/index.ts`.
//
// Home for types derived from the server's tRPC contract via
// `inferRouterOutputs<AppRouter>[...]` (the pattern already used in
// CompanyPaymentsCard, useCriticalMutation, copilotTransport, etc).
//
// The ENG-179c split is intentionally conservative: the hand-written
// domain models in `./domain` are also consumed by the offline /
// IndexedDB layer, not just as tRPC read-side mirrors, so migrating
// them wholesale to `inferRouterOutputs` would couple the offline
// buffer's types to the wire contract and risk a regression. That
// migration is deferred (see BACKLOG — ENG-179c follow-up). New DTOs
// that purely mirror a tRPC output should be added here as
// `inferRouterOutputs<AppRouter>['router']['procedure']` aliases rather
// than re-declared by hand.
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

/**
 * ENG-132h — one row of the admin fiscal-documents list
 * (`reports.fiscal.list`). Mirrors the frozen `fiscal_documents` snapshot the
 * server returns (buyer name, total, CUFE, provider id, xml ref, …) without any
 * `customers` / `products` join. Consumed by `FiscalDocumentListPage` and its
 * row-detail drawer.
 */
export type FiscalDocumentListItem =
  inferRouterOutputs<AppRouter>['reports']['fiscal']['list']['items'][number];
