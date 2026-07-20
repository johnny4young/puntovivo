// re-export shim.
//
// The former ~1000-line monolith was split into three focused modules:
// - `./ui`     — enums, string-literal unions, response wrappers (zero deps)
// - `./domain` — hand-written business-entity shapes (imports unions from ./ui)
// - `./api`    — tRPC `inferRouterOutputs` DTOs (home for future migration)
//
// This shim keeps the ~142 existing `@/types` import sites resolving for
// one release; new code should import from the specific module
// (`@/types/domain`, `@/types/ui`). Removal is tracked as
// follow-up.
export * from './ui';
export * from './domain';
export * from './api';
