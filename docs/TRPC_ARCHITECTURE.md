# tRPC Architecture for Open Yojob

## Executive Summary

This document analyzes the tRPC integration for Open Yojob and provides the architectural reference for implementation. tRPC enables end-to-end type-safe APIs without code generation, sharing types automatically between client and server.

**Status:** Phase 1 partially complete (health.check endpoint only). See `TRPC_IMPLEMENTATION_PLAN.md` for the full migration plan.

---

## Current Architecture

### Backend

- **Framework**: Fastify 5.x
- **Database**: SQLite with Drizzle ORM
- **API Style**: RESTful endpoints
- **Authentication**: JWT with @fastify/jwt
- **Real-time**: Server-Sent Events (SSE)

### Frontend

- **Framework**: React 19 with TypeScript
- **State Management**: TanStack Query + Zustand
- **API Client**: Custom fetch-based client

### Current Pain Points

1. **Type duplication**: Types defined separately on backend and frontend
2. **No compile-time validation**: API contract errors only caught at runtime
3. **Boilerplate**: ~150 lines per collection (routes + service + hooks)
4. **No API discovery**: Manual documentation required

---

## Why tRPC

### Integration with Existing Stack

tRPC integrates directly with the tools already in use:

- **Fastify**: Official tRPC adapter available (`@trpc/server/adapters/fastify`)
- **TanStack Query**: Native integration for React hooks
- **Drizzle ORM**: Works together seamlessly
- **Zod**: Built-in validation
- **JWT Auth**: Middleware implementation
- **SSE**: Can run alongside tRPC (subscriptions can replace SSE later)

### Quantified Benefits

| Metric               | Current (REST) | With tRPC      |
| -------------------- | -------------- | -------------- |
| Lines per collection | ~150           | ~30            |
| Files per collection | 3              | 2              |
| Type safety          | Manual         | End-to-end     |
| Compile-time errors  | No             | Yes            |
| IntelliSense         | Limited        | Full           |
| Bundle size impact   | -              | +~15KB gzipped |

### Code Comparison

**Current REST approach** (3 files, ~150 lines per collection):

```typescript
// Server: routes/products.ts
interface Product {
  id: string;
  name: string;
  price: number;
}

app.post('/api/collections/products', async (req, res) => {
  const data = req.body; // No automatic validation
  const product = await db.insert(products).values(data);
  res.send(product);
});

// Client: services/api/products.ts
export async function createProduct(data: CreateProductData): Promise<Product> {
  const response = await fetch('/api/collections/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

// Client: hooks/api/useProducts.ts
export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: data => createProduct(data),
    onSuccess: () => queryClient.invalidateQueries(['products']),
  });
}
```

**With tRPC** (2 files, ~30 lines per collection):

```typescript
// Server: trpc/routers/products.ts
export const productsRouter = router({
  create: tenantProcedure
    .input(z.object({ name: z.string(), price: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.db.insert(products).values(input); // Types flow automatically
    }),
});

// Client: just use it
const createProduct = trpc.products.create.useMutation();
createProduct.mutate({ name: 'Coffee', price: 2.5 }); // Fully typed
```

---

## Architecture Diagram

```
+-------------------------------------------------------------------+
|                       FRONTEND (React)                             |
+-------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |           React Components                                    | |
|  |  +----------+  +----------+  +----------+                    | |
|  |  | Products |  | Customers|  |  Sales   |  ...               | |
|  |  +----+-----+  +----+-----+  +----+-----+                    | |
|  |       |             |             |                           | |
|  |       +-------------+-------------+                           | |
|  |                     |                                         | |
|  |                     v                                         | |
|  |  +------------------------------------------------------+    | |
|  |  |     tRPC React Hooks (Auto-generated)                |    | |
|  |  |  useProductsList() / useCreateProduct() / ...        |    | |
|  |  |  Types inferred automatically, full IntelliSense     |    | |
|  |  +-------------------------+----------------------------+    | |
|  +----------------------------|-------------------------------+  |
|                               |                                  |
|  +----------------------------|-------------------------------+  |
|  |  TanStack Query            |                               |  |
|  |  Caching / Invalidation / Optimistic updates               |  |
|  +----------------------------|-------------------------------+  |
|                               |                                  |
|  +----------------------------|-------------------------------+  |
|  |  tRPC Client               |                               |  |
|  |  HTTP Batch Link + JWT Headers                             |  |
|  +----------------------------|-------------------------------+  |
|                               |                                  |
+-------------------------------|----------------------------------+
                                |
                                | HTTP/JSON (Typed) /api/trpc
                                |
+-------------------------------|----------------------------------+
|                               v                                   |
|                      BACKEND (Fastify)                            |
+-------------------------------------------------------------------+
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |  Fastify Server (Rate Limiting / CORS / JWT Verification)    | |
|  +-----------------------------+--------------------------------+ |
|                                |                                   |
|                                v                                   |
|  +--------------------------------------------------------------+ |
|  |  tRPC Fastify Adapter (Request handling / Error formatting)  | |
|  +-----------------------------+--------------------------------+ |
|                                |                                   |
|                                v                                   |
|  +--------------------------------------------------------------+ |
|  |  Context Creator                                              | |
|  |  ctx = { db, user: { id, email, role }, tenantId }           | |
|  +-----------------------------+--------------------------------+ |
|                                |                                   |
|                                v                                   |
|  +--------------------------------------------------------------+ |
|  |  Middleware Chain                                              | |
|  |  Auth Middleware (JWT verify) -> Tenant Middleware (Isolation) | |
|  +-----------------------------+--------------------------------+ |
|                                |                                   |
|                                v                                   |
|  +--------------------------------------------------------------+ |
|  |  Root Router                                                  | |
|  |  +----------+ +----------+ +----------+                      | |
|  |  | products | | customers| |  sales   | ...                  | |
|  |  +----+-----+ +----+-----+ +----+-----+                      | |
|  |       |             |             |                           | |
|  |       +-------------+-------------+                           | |
|  |                     |                                         | |
|  |                     v                                         | |
|  |  Procedures: Query (list, getById) / Mutation (create, ...)  | |
|  |  Zod validation + Native TypeScript types                    | |
|  +-----------------------------+--------------------------------+ |
|                                |                                   |
|                                v                                   |
|  +--------------------------------------------------------------+ |
|  |  Drizzle ORM + SQLite                                         | |
|  |  Type-safe queries / Migrations / Transactions                | |
|  +--------------------------------------------------------------+ |
|                                                                    |
+--------------------------------------------------------------------+
```

---

## Proposed File Structure

```
open_yojob/
+-- packages/server/
|   +-- src/
|       +-- trpc/                     # tRPC layer
|       |   +-- init.ts               # Base tRPC setup
|       |   +-- context.ts            # Context with DB, user, tenant
|       |   +-- router.ts             # Main router composition
|       |   +-- middleware/
|       |   |   +-- auth.ts           # JWT verification
|       |   |   +-- tenant.ts         # Tenant isolation
|       |   +-- routers/              # Domain routers
|       |   |   +-- products.ts
|       |   |   +-- categories.ts
|       |   |   +-- customers.ts
|       |   |   +-- sales.ts
|       |   |   +-- inventory.ts
|       |   +-- utils/
|       |       +-- product-schemas.ts # Zod schemas
|       |       +-- customer-schemas.ts
|       |       +-- common-schemas.ts
|       +-- routes/                   # Existing REST (keep during migration)
|       +-- index.ts                  # Add tRPC adapter registration
|
+-- apps/web/
    +-- src/
        +-- lib/
        |   +-- trpc.ts               # Configured tRPC client
        +-- hooks/api/
        |   +-- useProductsTRPC.ts     # tRPC hooks (new)
        |   +-- useProducts.ts        # REST hooks (keep during migration)
        +-- App.tsx                   # Add tRPC Provider
```

---

## Middleware Examples

### Authentication

```typescript
export const createContext = async ({ req }: { req: FastifyRequest }) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = token ? await verifyJWT(token) : null;
  return { db: req.server.db, user, tenantId: user?.tenantId };
};

const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.user } });
});
```

### Tenant Isolation

```typescript
const tenantProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  return next({ ctx: { ...ctx, tenantId: ctx.user.tenantId } });
});
```

### Rate Limiting Integration

```typescript
// Apply rate limiting at Fastify level before tRPC
app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

app.register(fastifyTRPCPlugin, {
  prefix: '/api/trpc',
  trpcOptions: { router: appRouter, createContext },
});
```

---

## Trade-offs

### Advantages

- End-to-end type safety eliminates entire classes of bugs
- 80% less boilerplate code to maintain
- Better DX with IntelliSense and autocomplete
- Compile-time error detection instead of runtime
- Perfect fit for TypeScript + TanStack Query + Fastify
- Production-ready (used by Cal.com, Ping.gg, and others)

### Disadvantages

- Learning curve (1-2 weeks to become proficient)
- Migration effort to convert existing REST endpoints
- Less flexible than REST for external API consumers
- Debugging requires understanding tRPC abstractions

### Mitigations

- Migration is gradual: run tRPC alongside existing REST API
- REST endpoints can be maintained for external use
- Strong documentation and community support

---

## Performance Impact

- **Bundle size**: +~15KB gzipped (negligible for desktop app)
- **Runtime**: Identical to REST (both use HTTP/JSON)
- **Optimization**: JSON-RPC batching can reduce request count
- **Build time**: +5-10% for more complex type checking

---

## Migration Path

See `TRPC_IMPLEMENTATION_PLAN.md` for the detailed phased migration plan.

**Phase 1** (PoC): Set up tRPC alongside REST, migrate one collection -- **partially done**
**Phase 2** (Migration): Migrate remaining collections one by one
**Phase 3** (Optimization): Add subscriptions to replace SSE, optimize bundle
**Phase 4** (Cleanup): Remove old REST endpoints and service layer

---

## Resources

- [tRPC Documentation](https://trpc.io)
- [Fastify Adapter](https://trpc.io/docs/server/adapters/fastify)
- [TanStack Query Integration](https://trpc.io/docs/client/react)
- [tRPC Discord Community](https://trpc.io/discord)
