# tRPC Architecture for Open Yojob

## Proposed Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           React Components                                │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐         │  │
│  │  │  Products  │  │  Customers │  │   Sales    │  ...    │  │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘         │  │
│  │        │               │               │                 │  │
│  │        └───────────────┴───────────────┘                 │  │
│  │                        │                                  │  │
│  │                        ▼                                  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │        tRPC React Hooks (Auto-generated)           │  │  │
│  │  │  • useProductsList()                               │  │  │
│  │  │  • useCreateProduct()                              │  │  │
│  │  │  • useUpdateProduct()                              │  │  │
│  │  │  ✅ Types inferred automatically                    │  │  │
│  │  │  ✅ Full IntelliSense                               │  │  │
│  │  └────────────────────┬───────────────────────────────┘  │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┼───────────────────────────────────┐  │
│  │     TanStack Query    │                                   │  │
│  │  • Caching            │                                   │  │
│  │  • Invalidation       │                                   │  │
│  │  • Optimistic updates │                                   │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┼───────────────────────────────────┐  │
│  │   tRPC Client         │                                   │  │
│  │  • HTTP Batch Link    │                                   │  │
│  │  • JWT Headers        │                                   │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           │ HTTP/JSON (Typed)
                           │ /api/trpc
                           │
┌──────────────────────────┼───────────────────────────────────────┐
│                          ▼                                        │
│                    BACKEND (Fastify)                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Fastify Server                               │  │
│  │  • Rate Limiting                                          │  │
│  │  • CORS                                                   │  │
│  │  • JWT Verification                                       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           tRPC Fastify Adapter                            │  │
│  │  • Request handling                                       │  │
│  │  • Error formatting                                       │  │
│  │  • Context creation                                       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Context Creator                              │  │
│  │  • Extract JWT user                                       │  │
│  │  • Extract tenant ID                                      │  │
│  │  • Inject DB instance                                     │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Middleware Chain                             │  │
│  │  ┌─────────────────┐  ┌─────────────────┐                │  │
│  │  │  Auth Middleware│→ │ Tenant Middleware│                │  │
│  │  │  (JWT verify)   │  │ (Isolation)      │                │  │
│  │  └─────────────────┘  └─────────────────┘                │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           Root Router (Composition)                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │  products   │  │  customers  │  │   sales     │ ...  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │  │
│  │         │                │                │              │  │
│  │         └────────────────┴────────────────┘              │  │
│  │                          │                                │  │
│  │                          ▼                                │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │          Procedures                              │    │  │
│  │  │  • Query: list, getById                          │    │  │
│  │  │  • Mutation: create, update, delete              │    │  │
│  │  │  ✅ Zod validation                                 │    │  │
│  │  │  ✅ Native TypeScript types                       │    │  │
│  │  └─────────────────────┬────────────────────────────┘    │  │
│  └────────────────────────┼───────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Drizzle ORM + SQLite                         │  │
│  │  • Type-safe queries                                      │  │
│  │  • Migrations                                             │  │
│  │  • Transactions                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Request Flow Example: Create Product

```
1. FRONTEND
   ┌────────────────────────────────────────────┐
   │ React Component                           │
   │                                            │
   │  const createProduct = useCreateProduct(); │
   │                                            │
   │  createProduct.mutate({                    │
   │    name: "Premium Coffee",                 │
   │    price: 2.50,                            │
   │    sku: "COFFEE-001"                       │
   │  });                                       │
   └────────────────┬───────────────────────────┘
                    │
                    │ ✅ TypeScript validates types
                    │    before sending
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ tRPC Client                                │
   │ • Serializes data to JSON                  │
   │ • Adds JWT header                          │
   │ • Adds tenant ID header                    │
   └────────────────┬───────────────────────────┘
                    │
                    │ POST /api/trpc/products.create
                    │ Content-Type: application/json
                    │ Authorization: Bearer <token>
                    │
                    ▼

2. NETWORK
   ────────────────────────────────────────────────
                    │
                    ▼

3. BACKEND
   ┌────────────────────────────────────────────┐
   │ Fastify Server                             │
   │ • Receives request                         │
   │ • Applies rate limiting                    │
   │ • Verifies CORS                            │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ tRPC Adapter                               │
   │ • Parses request                           │
   │ • Creates context                          │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Context Creator                            │
   │ ctx = {                                    │
   │   db: dbInstance,                          │
   │   user: { id, email, role },               │
   │   tenantId: "tenant-123"                   │
   │ }                                          │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Auth Middleware                            │
   │ ✅ Valid JWT → continue                     │
   │ ❌ Invalid JWT → error 401                  │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Tenant Middleware                          │
   │ ✅ tenantId present → continue              │
   │ ❌ no tenantId → error 403                  │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Zod Validation                             │
   │ ✅ Valid data → continue                    │
   │ ❌ Invalid data → error 400                 │
   │    with detailed error message             │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Procedure Handler                          │
   │                                            │
   │  async ({ input, ctx }) => {               │
   │    const product = {                       │
   │      id: nanoid(),                         │
   │      ...input,                             │
   │      tenantId: ctx.tenantId,               │
   │      createdAt: now(),                     │
   │    };                                      │
   │                                            │
   │    await ctx.db.insert(products)           │
   │      .values(product);                     │
   │                                            │
   │    return product;                         │
   │  }                                         │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Drizzle ORM                                │
   │ • INSERT INTO products (...)               │
   │ • Type-safe query                          │
   │ • Auto-commit                              │
   └────────────────┬───────────────────────────┘
                    │
                    │ ✅ Success
                    │
                    ▼

4. RESPONSE
   ────────────────────────────────────────────────
                    │
                    │ 200 OK
                    │ { id, name, price, ... }
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ tRPC Client                                │
   │ • Parses response                          │
   │ • Validates types                          │
   │ • Updates cache (TanStack Query)           │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ React Component                            │
   │ • onSuccess callback executed              │
   │ • UI updated automatically                 │
   │ • Product appears in list                  │
   └────────────────────────────────────────────┘
```

## Comparison: REST vs tRPC

### CURRENT (REST)

```typescript
// ❌ BACKEND - Define types manually
interface Product {
  id: string;
  name: string;
  price: number;
}

app.post('/api/collections/products', async (req, res) => {
  // No automatic validation
  const data = req.body;
  
  // No type checking
  const product = await db.insert(products).values(data);
  res.send(product);
});

// ❌ FRONTEND - Duplicate types
interface Product {  // ⚠️ Duplicated!
  id: string;
  name: string;
  price: number;
}

// ❌ Define API function manually
export async function createProduct(data: CreateProductData): Promise<Product> {
  const response = await fetch('/api/collections/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

// ❌ Create hook manually
export function useCreateProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['products']);
    },
  });
}

// ❌ Use in component (no type checking)
const createProduct = useCreateProduct();
createProduct.mutate({ nam: 'Coffee' });  // ⚠️ Error only at runtime!
```

**Problems:**
- 3 files to maintain
- Types duplicated
- No automatic validation
- Errors only at runtime
- ~150 lines of code

---

### PROPOSED (tRPC)

```typescript
// ✅ BACKEND - Define once
const productSchema = z.object({
  name: z.string(),
  price: z.number(),
  sku: z.string(),
});

export const productsRouter = router({
  create: tenantProcedure
    .input(productSchema)  // ✅ Automatic validation
    .mutation(async ({ input, ctx }) => {
      // ✅ input is validated and typed
      const product = await ctx.db.insert(products).values(input);
      return product;  // ✅ Type automatically inferred
    }),
});

// ✅ FRONTEND - Just import type
import { trpc } from '@/lib/trpc';

// ✅ Hook auto-generated
const createProduct = trpc.products.create.useMutation();

// ✅ Use in component (full type checking)
createProduct.mutate({ 
  name: 'Coffee',  // ✅ TypeScript validates
  price: 2.50,
  sku: 'COFFEE-001'
});

createProduct.mutate({ 
  nam: 'Coffee'  // ❌ TypeScript error IMMEDIATELY
});
```

**Advantages:**
- 2 files to maintain
- Types defined once
- Automatic validation with Zod
- Errors at compile-time
- ~30 lines of code

**Reduction: 80% less code, 100% safer**

## Proposed File Structure

```
open_yojob/
├── packages/server/
│   └── src/
│       ├── trpc/                     # 🆕 New tRPC folder
│       │   ├── init.ts               # Base tRPC setup
│       │   ├── context.ts            # Context with DB, user, tenant
│       │   ├── router.ts             # Main router
│       │   ├── middleware/
│       │   │   ├── auth.ts           # JWT verification
│       │   │   └── tenant.ts         # Tenant isolation
│       │   ├── routers/              # Routers by domain
│       │   │   ├── products.ts       # CRUD products
│       │   │   ├── categories.ts
│       │   │   ├── customers.ts
│       │   │   ├── sales.ts
│       │   │   └── inventory.ts
│       │   └── utils/
│       │       ├── product-schemas.ts # Zod schemas
│       │       ├── customer-schemas.ts
│       │       └── common-schemas.ts
│       ├── routes/                   # 📦 Keep for now (legacy)
│       │   ├── auth.ts
│       │   ├── collections.ts
│       │   └── sync.ts
│       └── index.ts                  # ✏️ Modify: add tRPC adapter
│
└── apps/web/
    └── src/
        ├── lib/
        │   └── trpc.ts               # 🆕 Configured tRPC client
        ├── hooks/
        │   └── api/
        │       ├── useProductsTRPC.ts # 🆕 tRPC hooks
        │       ├── useCustomersTRPC.ts
        │       ├── useProducts.ts    # 📦 Keep temporarily
        │       └── useCustomers.ts   # 📦 Keep temporarily
        ├── services/
        │   └── api/
        │       ├── client.ts         # 📦 Simplify later
        │       ├── products.ts       # ❌ Delete in Phase 4
        │       └── customers.ts      # ❌ Delete in Phase 4
        └── App.tsx                   # ✏️ Modify: add tRPC Provider
```

**Legend:**
- 🆕 = New files
- ✏️ = Files to modify
- 📦 = Keep temporarily (gradual migration)
- ❌ = Delete in Phase 4 (final cleanup)

## Benefits Visualization

```
┌─────────────────────────────────────────────────────────┐
│                BENEFITS OF tRPC                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. TYPE SAFETY END-TO-END                              │
│     ┌────────┐                    ┌────────┐           │
│     │ Server │ ══════════════════►│ Client │           │
│     └────────┘   Types flow       └────────┘           │
│                  automatically                          │
│                                                         │
│  2. LESS CODE                                           │
│     BEFORE: ~150 lines/collection                       │
│     ╔════════════════════════════════════╗              │
│     ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║              │
│     ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║              │
│     ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║              │
│     ╚════════════════════════════════════╝              │
│                                                         │
│     AFTER: ~30 lines/collection (-80%)                  │
│     ╔═══════╗                                           │
│     ║░░░░░░░║                                           │
│     ╚═══════╝                                           │
│                                                         │
│  3. ERRORS DETECTED EARLIER                             │
│     Runtime Errors:  ▓▓▓▓▓▓▓▓▓▓ (10)                    │
│     Compile Errors:  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (20)          │
│     ✅ Better to catch in compilation than production    │
│                                                         │
│  4. DEVELOPER EXPERIENCE                                │
│     BEFORE:                                             │
│     ┌─────────────┐                                     │
│     │ No IntelliSense                                   │
│     │ Manual types                                      │
│     │ Runtime errors                                    │
│     └─────────────┘                                     │
│                                                         │
│     AFTER:                                              │
│     ┌─────────────┐                                     │
│     │ ✅ Full IntelliSense                               │
│     │ ✅ Automatic types                                 │
│     │ ✅ Compile-time errors                             │
│     │ ✅ Safe refactoring                                │
│     └─────────────┘                                     │
│                                                         │
│  5. MAINTAINABILITY                                     │
│     Files per collection:                               │
│     BEFORE: 3 files (~250 lines)                        │
│     AFTER: 2 files (~80 lines)                          │
│     ✅ 68% less code to maintain                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

**Document**: Architecture and Flow Diagrams  
**Date**: February 2026  
**Version**: 1.0  
**Status**: Technical reference for implementation
