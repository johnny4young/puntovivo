# tRPC Implementation Plan for Open Yojob

## Introduction

This document details the step-by-step plan for integrating tRPC into the Open Yojob project, based on the positive analysis conducted. The implementation will be divided into incremental phases to minimize risks and allow for continuous validation.

---

## Plan Summary

| Phase | Duration | Objective | Risk |
|------|----------|----------|--------|
| Phase 1: Base Setup | 2-3 days | tRPC setup and minimal PoC | Low |
| Phase 2: Pilot Collection Migration | 3-4 days | Products fully migrated | Medium |
| Phase 3: Remaining Collections | 1-2 weeks | All collections | Low |
| Phase 4: Optimization and Cleanup | 3-4 days | Remove legacy code | Low |

**Total Estimated Time**: 3-4 weeks

---

## Phase 1: Base Setup (2-3 days)

### Objective
Configure the base tRPC infrastructure without affecting existing code.

### Tasks

#### 1.1 Install Dependencies

```bash
# In the server package
cd packages/server
npm install @trpc/server zod

# In the web application
cd ../../apps/web
npm install @trpc/client @trpc/react-query @trpc/server
```

#### 1.2 Create Folder Structure

```bash
# In packages/server/src/
mkdir -p trpc/{middleware,routers,utils}

# Resulting structure:
# packages/server/src/trpc/
# ├── init.ts                # Base tRPC initialization
# ├── context.ts             # Context with DB, user, tenant
# ├── router.ts              # Main router that combines all
# ├── middleware/
# │   ├── auth.ts            # JWT verification
# │   └── tenant.ts          # Tenant isolation
# ├── routers/
# │   └── (empty for now)
# └── utils/
#     └── common-schemas.ts  # Reusable Zod schemas
```

#### 1.3 Configure Base tRPC Initializer

Create `packages/server/src/trpc/init.ts`:

```typescript
import { initTRPC } from '@trpc/server';
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
```

#### 1.4 Configure Request Context

Create `packages/server/src/trpc/context.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../db/index.js';

export interface Context {
  req: FastifyRequest;
  res: FastifyReply;
  db: DatabaseInstance;
  user: {
    id: string;
    email: string;
    role: string;
    tenantId: string;
  } | null;
  tenantId: string | null;
}

export async function createContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<Context> {
  let user = null;
  let tenantId = null;

  // Try to extract user from JWT if it exists
  try {
    await req.jwtVerify();
    const payload = req.user as any;
    user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
    };
    tenantId = payload.tenantId;
  } catch {
    // No valid token - allow public procedures
  }

  return {
    req,
    res,
    db: req.server.db,
    user,
    tenantId,
  };
}
```

#### 1.5 Create Authentication Middlewares

Create `packages/server/src/trpc/middleware/auth.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { middleware, publicProcedure } from '../init.js';

const isAuthenticated = middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user, // Already verified to not be null
    },
  });
});

export const protectedProcedure = publicProcedure.use(isAuthenticated);
```

Create `packages/server/src/trpc/middleware/tenant.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { middleware } from '../init.js';
import { protectedProcedure } from './auth.js';

const requireTenant = middleware(async ({ ctx, next }) => {
  if (!ctx.tenantId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Restricted access - tenant context required',
    });
  }

  return next({
    ctx: {
      ...ctx,
      tenantId: ctx.tenantId, // Already verified to not be null
    },
  });
});

export const tenantProcedure = protectedProcedure.use(requireTenant);
```

#### 1.6 Create Root Router

Create `packages/server/src/trpc/router.ts`:

```typescript
import { router } from './init.js';

// Empty router for now
export const appRouter = router({
  // Domain routers will be added here
});

export type AppRouter = typeof appRouter;
```

#### 1.7 Integrate with Fastify

Modify `packages/server/src/index.ts` to add the tRPC adapter:

```typescript
// Add imports
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';

// In the createServer function, after registering JWT and before REST routes:
  
  // Register tRPC
  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }) {
        console.error(`[tRPC] Error in ${path ?? 'unknown'}:`, error);
      },
    },
  });

  // ... register existing REST routes (keep for now)
```

#### 1.8 Configure tRPC Client in Frontend

Create `apps/web/src/lib/trpc.ts`:

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@open-yojob/server';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8090';

// React client for hooks
export const trpc = createTRPCReact<AppRouter>();

// Vanilla client for use outside React components
export const vanillaClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/api/trpc`,
      headers() {
        const token = localStorage.getItem('auth_token');
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
```

#### 1.9 Configure Provider in App

Modify `apps/web/src/App.tsx`:

```typescript
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './lib/trpc';

function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${import.meta.env.VITE_API_URL || 'http://localhost:8090'}/api/trpc`,
          headers() {
            const token = localStorage.getItem('auth_token');
            return token ? { authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* Rest of the app */}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

#### 1.10 Verify Setup

Create a simple test procedure:

```typescript
// In router.ts
export const appRouter = router({
  health: router({
    check: publicProcedure.query(() => {
      return { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        message: 'tRPC is working correctly'
      };
    }),
  }),
});
```

Test in frontend:

```typescript
// In any component
const { data } = trpc.health.check.useQuery();
console.log(data); // Should display the object with full typing
```

### Phase 1 Success Criteria
- ✅ tRPC installed on server and client
- ✅ Context configured with DB and authentication
- ✅ Auth middlewares working
- ✅ Router integrated in Fastify
- ✅ React client configured
- ✅ Test procedure works end-to-end

---

## Phase 2: Pilot Collection Migration - Products (3-4 days)

### Objective
Fully migrate the products collection to tRPC as a proof of concept.

### 2.1 Create Validation Schemas

Create `packages/server/src/trpc/utils/product-schemas.ts`:

```typescript
import { z } from 'zod';

export const productBaseSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  sku: z.string().min(1).max(50),
  description: z.string().optional(),
  categoryId: z.string(),
  price: z.number().positive('Price must be positive'),
  cost: z.number().nonnegative('Cost cannot be negative'),
  taxRate: z.number().min(0).max(100),
  stock: z.number().int().nonnegative().default(0),
  minStock: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
  barcode: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
});

export const createProductSchema = productBaseSchema;

export const updateProductSchema = productBaseSchema.partial();

export const getProductSchema = z.object({
  id: z.string(),
});

export const listProductsSchema = z.object({
  page: z.number().int().positive().default(1),
  perPage: z.number().int().min(1).max(100).default(50),
  search: z.string().optional(),
  categoryId: z.string().optional(),
  isActive: z.boolean().optional(),
  sortBy: z.enum(['name', 'price', 'stock', 'createdAt']).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});
```

### 2.2 Create Products Router

Create `packages/server/src/trpc/routers/products.ts`:

```typescript
import { eq, and, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { TRPCError } from '@trpc/server';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { products, syncQueue } from '../../db/schema.js';
import {
  listProductsSchema,
  getProductSchema,
  createProductSchema,
  updateProductSchema,
} from '../utils/product-schemas.js';

export const productsRouter = router({
  list: tenantProcedure
    .input(listProductsSchema)
    .query(async ({ input, ctx }) => {
      const { page, perPage, search, categoryId, isActive, sortBy, sortDirection } = input;
      
      const offset = (page - 1) * perPage;
      
      // Build WHERE conditions
      const conditions = [eq(products.tenantId, ctx.tenantId)];
      
      if (search) {
        conditions.push(
          or(
            like(products.name, `%${search}%`),
            like(products.sku, `%${search}%`),
            like(products.barcode, `%${search}%`)
          ) as any
        );
      }
      
      if (categoryId) {
        conditions.push(eq(products.categoryId, categoryId));
      }
      
      if (isActive !== undefined) {
        conditions.push(eq(products.isActive, isActive));
      }
      
      // Get total count
      const [countResult] = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(and(...conditions));
      
      const totalItems = countResult?.count ?? 0;
      const totalPages = Math.ceil(totalItems / perPage);
      
      // Get items
      const items = await ctx.db
        .select()
        .from(products)
        .where(and(...conditions))
        .limit(perPage)
        .offset(offset)
        .orderBy(
          sortDirection === 'asc' 
            ? sql`${products[sortBy]} ASC` 
            : sql`${products[sortBy]} DESC`
        );
      
      return {
        items,
        pagination: {
          page,
          perPage,
          totalItems,
          totalPages,
        },
      };
    }),

  getById: tenantProcedure
    .input(getProductSchema)
    .query(async ({ input: { id }, ctx }) => {
      const [product] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.tenantId, ctx.tenantId)
          )
        )
        .limit(1);
      
      if (!product) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Product not found',
        });
      }
      
      return product;
    }),

  create: tenantProcedure
    .input(createProductSchema)
    .mutation(async ({ input, ctx }) => {
      const now = new Date().toISOString();
      const newId = nanoid();
      
      const newProduct = {
        id: newId,
        ...input,
        tenantId: ctx.tenantId,
        syncStatus: 'pending' as const,
        syncVersion: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      await ctx.db.insert(products).values(newProduct);
      
      // Add to sync queue
      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: 'products',
        entityId: newId,
        operation: 'create',
        data: newProduct,
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });
      
      // Emit SSE event (if configured)
      if (ctx.req.server.sse) {
        ctx.req.server.sse.broadcast('products.create', newProduct);
      }
      
      return newProduct;
    }),

  update: tenantProcedure
    .input(z.object({
      id: z.string(),
      data: updateProductSchema,
    }))
    .mutation(async ({ input: { id, data }, ctx }) => {
      // Verify exists and belongs to tenant
      const [existing] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.tenantId, ctx.tenantId)
          )
        )
        .limit(1);
      
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Product not found',
        });
      }
      
      const now = new Date().toISOString();
      const updatedData = {
        ...data,
        syncStatus: 'pending' as const,
        syncVersion: existing.syncVersion + 1,
        updatedAt: now,
      };
      
      await ctx.db
        .update(products)
        .set(updatedData)
        .where(eq(products.id, id));
      
      // Add to sync queue
      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: 'products',
        entityId: id,
        operation: 'update',
        data: updatedData,
        localVersion: existing.syncVersion + 1,
        attempts: 0,
        createdAt: now,
      });
      
      // Emit SSE event
      if (ctx.req.server.sse) {
        ctx.req.server.sse.broadcast('products.update', {
          id,
          ...updatedData,
        });
      }
      
      // Return updated product
      const [updatedProduct] = await ctx.db
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      
      return updatedProduct!;
    }),

  delete: tenantProcedure
    .input(getProductSchema)
    .mutation(async ({ input: { id }, ctx }) => {
      // Only admins can delete
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only administrators can delete products',
        });
      }
      
      // Verify exists and belongs to tenant
      const [existing] = await ctx.db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.tenantId, ctx.tenantId)
          )
        )
        .limit(1);
      
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Product not found',
        });
      }
      
      await ctx.db
        .delete(products)
        .where(eq(products.id, id));
      
      const now = new Date().toISOString();
      
      // Add to sync queue
      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: 'products',
        entityId: id,
        operation: 'delete',
        data: { id },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });
      
      // Emit SSE event
      if (ctx.req.server.sse) {
        ctx.req.server.sse.broadcast('products.delete', { id });
      }
      
      return { success: true, id };
    }),
});
```

### 2.3 Add Products Router to Root Router

Modify `packages/server/src/trpc/router.ts`:

```typescript
import { router } from './init.js';
import { productsRouter } from './routers/products.js';

export const appRouter = router({
  health: router({
    check: publicProcedure.query(() => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })),
  }),
  products: productsRouter,
});

export type AppRouter = typeof appRouter;
```

### 2.4 Create React Hooks for Products

Create `apps/web/src/hooks/api/useProductsTRPC.ts`:

```typescript
import { trpc } from '@/lib/trpc';

// Query hooks with descriptive names
export const useProductsList = trpc.products.list.useQuery;
export const useProduct = trpc.products.getById.useQuery;

// Mutation hooks
export const useCreateProduct = trpc.products.create.useMutation;
export const useUpdateProduct = trpc.products.update.useMutation;
export const useDeleteProduct = trpc.products.delete.useMutation;

// Custom hook with automatic invalidation
export function useCreateProductWithInvalidation() {
  const utils = trpc.useUtils();
  
  return trpc.products.create.useMutation({
    onSuccess: () => {
      // Invalidate product list to refresh
      utils.products.list.invalidate();
    },
  });
}

export function useUpdateProductWithInvalidation() {
  const utils = trpc.useUtils();
  
  return trpc.products.update.useMutation({
    onSuccess: (updatedData) => {
      // Invalidate both list and specific detail
      utils.products.list.invalidate();
      utils.products.getById.invalidate({ id: updatedData.id });
    },
  });
}

export function useDeleteProductWithInvalidation() {
  const utils = trpc.useUtils();
  
  return trpc.products.delete.useMutation({
    onSuccess: (_, { id }) => {
      utils.products.list.invalidate();
      utils.products.getById.invalidate({ id });
    },
  });
}
```

### 2.5 Update Components to Use tRPC

Example component migration:

```typescript
// BEFORE (with REST API)
import { useProducts, useCreateProduct } from '@/hooks/api/useProducts';

function ProductsList() {
  const { data, isLoading } = useProducts({ page: 1, perPage: 50 });
  const createProduct = useCreateProduct();
  
  // ...
}

// AFTER (with tRPC)
import { 
  useProductsList, 
  useCreateProductWithInvalidation 
} from '@/hooks/api/useProductsTRPC';

function ProductsList() {
  const { data, isLoading } = useProductsList({ 
    page: 1, 
    perPage: 50 
  });
  const createProduct = useCreateProductWithInvalidation();
  
  // Automatic typing - 'data' has full type inference
  // data.items is Product[]
  // data.pagination has page, totalItems, etc.
}
```

### 2.6 End-to-End Testing

1. **Read test**: Verify products list displays correctly
2. **Create test**: Create a new product and verify it appears in list
3. **Update test**: Modify a product and verify changes
4. **Delete test**: Delete a product (as admin)
5. **Type test**: Verify TypeScript catches errors at compile-time

### Phase 2 Success Criteria
- ✅ Complete products router with all CRUD operations
- ✅ Zod schemas validating input correctly
- ✅ React hooks working with full typing
- ✅ Migrated components working without errors
- ✅ Tenant isolation working correctly
- ✅ Sync queue functioning
- ✅ REST API for products can coexist (not deleted yet)

---

## Phase 3: Migrate Remaining Collections (1-2 weeks)

### Objective
Migrate remaining collections using the pattern established in Phase 2.

### Suggested Migration Order

1. **Categories** (1 day) - Simple, no complex relations
2. **Customers** (1 day) - Similar to products
3. **Sales** (2 days) - More complex, includes sale items
4. **Inventory** (2 days) - Inventory movements
5. **Authentication** (1 day) - Migrate auth endpoints

### Migration Template

For each collection, follow this pattern:

1. **Create schemas** in `trpc/utils/schemas-{collection}.ts`
2. **Create router** in `trpc/routers/{collection}.ts`
3. **Add to root router** in `router.ts`
4. **Create React hooks** in `hooks/api/use{Collection}TRPC.ts`
5. **Migrate components** one by one
6. **Test** end-to-end functionality
7. **Document** any particularities

### Collection-Specific Notes

#### Categories
- Tree structure (parent-child)
- Add procedure to get complete tree
- Validate no cycles are created

#### Customers
- Similar to products
- Add search by name, email, phone

#### Sales
- Transactional - create sale + items in single mutation
- Use Drizzle transactions
- Update product stock automatically

```typescript
createSale: tenantProcedure
  .input(createSaleSchema)
  .mutation(async ({ input, ctx }) => {
    return ctx.db.transaction(async (tx) => {
      // 1. Create sale
      const sale = await tx.insert(sales).values(/* ... */);
      
      // 2. Create sale items
      await tx.insert(saleItems).values(input.items);
      
      // 3. Update product stock
      for (const item of input.items) {
        await tx
          .update(products)
          .set({ stock: sql`stock - ${item.quantity}` })
          .where(eq(products.id, item.productId));
      }
      
      return sale;
    });
  }),
```

#### Inventory
- Entry/exit movements
- Validate sufficient stock for exits
- Update product stock

### Phase 3 Success Criteria
- ✅ All collections migrated to tRPC
- ✅ Frontend fully functional with tRPC
- ✅ REST API still available (not deleted)
- ✅ All tests passing
- ✅ Performance equivalent or better than REST

---

## Phase 4: Optimization and Cleanup (3-4 days)

### Objective
Optimize implementation and remove legacy code.

### 4.1 Optimizations

#### Implement Batching
Batching groups multiple queries into a single HTTP request:

```typescript
// In trpc.ts
links: [
  httpBatchLink({
    url: `${API_URL}/api/trpc`,
    maxURLLength: 2083,
    // Queries are automatically batched
  }),
],
```

#### Implement Subscriptions (Replace SSE)

```typescript
// On server
import { observable } from '@trpc/server/observable';

onProductChange: tenantProcedure
  .subscription(({ ctx }) => {
    return observable<ProductChange>((emit) => {
      const handler = (change: ProductChange) => {
        if (change.tenantId === ctx.tenantId) {
          emit.next(change);
        }
      };
      
      changeEvents.on('product:change', handler);
      
      return () => {
        changeEvents.off('product:change', handler);
      };
    });
  }),

// On client
trpc.products.onProductChange.useSubscription(undefined, {
  onData: (change) => {
    console.log('Change received:', change);
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  },
});
```

### 4.2 Add tRPC Panel (Development Tool)

```bash
npm install trpc-panel
```

```typescript
// In development, expose tRPC Panel
if (process.env.NODE_ENV === 'development') {
  await app.register(import('@trpc/server/adapters/fastify'), {
    prefix: '/panel',
    trpcOptions: {
      router: appRouter,
      createContext,
    },
  });
}
```

Access `http://localhost:8090/panel` to visually explore and test the API.

### 4.3 Remove Legacy Code

Once tRPC is validated to work correctly:

1. **Delete old REST API services**:
   - `apps/web/src/services/api/products.ts`
   - `apps/web/src/services/api/customers.ts`
   - Etc.

2. **Delete old hooks**:
   - `apps/web/src/hooks/api/useProducts.ts`
   - `apps/web/src/hooks/api/useCustomers.ts`
   - Etc.

3. **Update API client**:
   - Simplify `apps/web/src/services/api/client.ts`
   - Keep only auth functions if necessary

4. **Consider removing REST routes from server** (or keep for external APIs):
   - `packages/server/src/routes/collections.ts` (if no longer used)

5. **Update documentation**:
   - README.md
   - docs/ARCHITECTURE.md
   - Add tRPC usage examples

### 4.4 Bundle Optimization

Analyze bundle size:

```bash
cd apps/web
npm run build
# Analyze output

# If necessary, consider:
# - Tree-shaking of unused dependencies
# - Code splitting of large routers
```

### Phase 4 Success Criteria
- ✅ Batching implemented and working
- ✅ Subscriptions working (if implemented)
- ✅ tRPC Panel configured for development
- ✅ Legacy code deleted
- ✅ Documentation updated
- ✅ Acceptable bundle size (<500KB total)
- ✅ Performance equal to or better than before

---

## Testing and Validation

### Functional Testing

Create test suite for each router:

```typescript
// packages/server/src/trpc/__tests__/products.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestContext } from '../utils/test-helpers';
import { productsRouter } from '../routers/products';

describe('Products Router', () => {
  let context: Context;
  
  beforeEach(() => {
    context = createTestContext();
  });
  
  it('should list products', async () => {
    const caller = productsRouter.createCaller(context);
    const result = await caller.list({ page: 1, perPage: 10 });
    
    expect(result.items).toBeInstanceOf(Array);
    expect(result.pagination.totalItems).toBeGreaterThanOrEqual(0);
  });
  
  it('should create a product', async () => {
    const caller = productsRouter.createCaller(context);
    const newProduct = await caller.create({
      name: 'Test Product',
      sku: 'TEST-001',
      categoryId: 'cat-123',
      price: 10.99,
      cost: 5.00,
      taxRate: 16,
    });
    
    expect(newProduct.id).toBeDefined();
    expect(newProduct.name).toBe('Test Product');
  });
  
  it('should reject creation with invalid data', async () => {
    const caller = productsRouter.createCaller(context);
    
    await expect(
      caller.create({
        name: '', // Empty name - invalid
        sku: 'TEST-001',
        categoryId: 'cat-123',
        price: -10, // Negative price - invalid
        cost: 5.00,
        taxRate: 16,
      })
    ).rejects.toThrow();
  });
});
```

### Integration Testing

```typescript
// apps/web/src/__tests__/integration/products.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductsList } from '@/features/products/ProductsList';

describe('Products Integration with tRPC', () => {
  it('should load and display products', async () => {
    const queryClient = new QueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <ProductsList />
      </QueryClientProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/products/i)).toBeInTheDocument();
    });
  });
});
```

### Performance Testing

Compare performance before and after:

```typescript
// Benchmark script
async function benchmarkAPI() {
  console.time('REST API - 100 requests');
  for (let i = 0; i < 100; i++) {
    await fetch('http://localhost:8090/api/collections/products');
  }
  console.timeEnd('REST API - 100 requests');
  
  console.time('tRPC - 100 requests');
  for (let i = 0; i < 100; i++) {
    await vanillaClient.products.list.query({ page: 1, perPage: 50 });
  }
  console.timeEnd('tRPC - 100 requests');
  
  console.time('tRPC with batching - 100 requests');
  await Promise.all(
    Array.from({ length: 100 }, () =>
      vanillaClient.products.list.query({ page: 1, perPage: 50 })
    )
  );
  console.timeEnd('tRPC with batching - 100 requests');
}
```

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|------------|---------|------------|
| Bugs during migration | Medium | High | Keep REST in parallel, migrate gradually |
| Team learning curve | High | Medium | Documentation, pair programming, training |
| Degraded performance | Low | High | Continuous benchmarks, optimizations |
| Incompatibility with existing tools | Low | Medium | Exhaustive testing, prior research |
| Excessive bundle increase | Low | Low | Tree-shaking, bundle analysis |

---

## Rollback Plan

If you need to revert the migration:

1. **Phase 1-2**: Simply disable tRPC in Fastify, REST code still works
2. **Phase 3**: Revert components to use old REST hooks (still available)
3. **Phase 4**: If legacy code already deleted, use Git to recover it

```bash
# Revert to commit before deleting legacy code
git revert <commit-hash>

# Or create backup branch before Phase 4
git branch backup-pre-cleanup
```

---

## Implementation Checklist

### Preparation
- [ ] Team trained in basic tRPC concepts
- [ ] Repository backed up
- [ ] Existing tests documented
- [ ] Communication plan with stakeholders

### Phase 1: Setup
- [ ] Dependencies installed
- [ ] Folder structure created
- [ ] Initializer and context configured
- [ ] Auth middlewares implemented
- [ ] Root router created
- [ ] Fastify integration complete
- [ ] React client configured
- [ ] Test procedure works

### Phase 2: Products PoC
- [ ] Zod schemas created
- [ ] Products router implemented
- [ ] React hooks created
- [ ] At least one component migrated
- [ ] End-to-end tests passing
- [ ] Acceptable performance
- [ ] Team validates implementation

### Phase 3: Full Migration
- [ ] Categories migrated
- [ ] Customers migrated
- [ ] Sales migrated
- [ ] Inventory migrated
- [ ] Authentication migrated
- [ ] All components updated
- [ ] Test suite updated

### Phase 4: Optimization
- [ ] Batching implemented
- [ ] Subscriptions evaluated/implemented
- [ ] tRPC Panel configured
- [ ] Legacy code deleted
- [ ] Documentation updated
- [ ] Bundle size optimized
- [ ] Performance benchmarks completed

### Post-Implementation
- [ ] Error monitoring in production
- [ ] Team feedback collected
- [ ] Lessons learned documented
- [ ] Continuous improvement plan established

---

## Resources and References

### Documentation
- **Official tRPC**: https://trpc.io/docs
- **Fastify Adapter**: https://trpc.io/docs/server/adapters/fastify
- **React Query Integration**: https://trpc.io/docs/client/react
- **Zod Documentation**: https://zod.dev

### Development Tools
- **tRPC Panel**: https://github.com/iway1/trpc-panel
- **tRPC Playground**: https://github.com/sachinraja/trpc-playground
- **tRPC Chrome Extension**: For debugging

### Examples and Templates
- tRPC examples repository: https://github.com/trpc/examples-next-prisma-starter
- Examples with Fastify: https://github.com/trpc/trpc/tree/main/examples/fastify-server

---

## Conclusion

This plan provides a clear and safe path to migrate Open Yojob to tRPC. Gradual migration minimizes risks while allowing validation of benefits at each phase.

**Next Step**: Get team approval and start with Phase 1.

---

**Plan Version**: 1.0  
**Last Updated**: February 2026  
**Status**: Proposal - Pending approval
