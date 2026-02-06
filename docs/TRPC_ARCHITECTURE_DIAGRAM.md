# Arquitectura tRPC para Open Yojob

## Diagrama de Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Componentes React                               │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐         │  │
│  │  │  Products  │  │  Customers │  │   Sales    │  ...    │  │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘         │  │
│  │        │               │               │                 │  │
│  │        └───────────────┴───────────────┘                 │  │
│  │                        │                                  │  │
│  │                        ▼                                  │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │        tRPC React Hooks (Auto-generated)           │  │  │
│  │  │  • useListadoProductos()                           │  │  │
│  │  │  • useCrearProducto()                              │  │  │
│  │  │  • useActualizarProducto()                         │  │  │
│  │  │  ✅ Tipos inferidos automáticamente                 │  │  │
│  │  │  ✅ IntelliSense completo                           │  │  │
│  │  └────────────────────┬───────────────────────────────┘  │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┼───────────────────────────────────┐  │
│  │     TanStack Query    │                                   │  │
│  │  • Cache              │                                   │  │
│  │  • Invalidation       │                                   │  │
│  │  • Optimistic updates │                                   │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────┼───────────────────────────────────┐  │
│  │   Cliente tRPC        │                                   │  │
│  │  • HTTP Batch Link    │                                   │  │
│  │  • JWT Headers        │                                   │  │
│  └───────────────────────┼───────────────────────────────────┘  │
│                          │                                       │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           │ HTTP/JSON (Tipado)
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
│  │           Router Raíz (Composición)                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │  productos  │  │  clientes   │  │   ventas    │ ...  │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │  │
│  │         │                │                │              │  │
│  │         └────────────────┴────────────────┘              │  │
│  │                          │                                │  │
│  │                          ▼                                │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │          Procedimientos (Procedures)             │    │  │
│  │  │  • Query: listar, consultarPorId                 │    │  │
│  │  │  • Mutation: crear, actualizar, eliminar         │    │  │
│  │  │  ✅ Validación con Zod                            │    │  │
│  │  │  ✅ Tipos TypeScript nativos                      │    │  │
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

## Flujo de una Petición (Ejemplo: Crear Producto)

```
1. FRONTEND
   ┌────────────────────────────────────────────┐
   │ Componente React                           │
   │                                            │
   │  const crear = useCrearProductoTRPC();     │
   │                                            │
   │  crear.mutate({                            │
   │    nombre: "Café Premium",                 │
   │    precio: 2.50,                           │
   │    sku: "CAF-001"                          │
   │  });                                       │
   └────────────────┬───────────────────────────┘
                    │
                    │ ✅ TypeScript valida tipos
                    │    antes de enviar
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Cliente tRPC                               │
   │ • Serializa datos a JSON                   │
   │ • Agrega JWT header                        │
   │ • Agrega tenant ID header                  │
   └────────────────┬───────────────────────────┘
                    │
                    │ POST /api/trpc/productos.crear
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
   │ • Recibe petición                          │
   │ • Aplica rate limiting                     │
   │ • Verifica CORS                            │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ tRPC Adapter                               │
   │ • Parsea request                           │
   │ • Crea contexto                            │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Context Creator                            │
   │ ctx = {                                    │
   │   db: dbInstance,                          │
   │   usuarioActual: { id, email, rol },       │
   │   tenantId: "tenant-123"                   │
   │ }                                          │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Auth Middleware                            │
   │ ✅ JWT válido → continuar                   │
   │ ❌ JWT inválido → error 401                 │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Tenant Middleware                          │
   │ ✅ tenantId presente → continuar            │
   │ ❌ sin tenantId → error 403                 │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Zod Validation                             │
   │ ✅ Datos válidos → continuar                │
   │ ❌ Datos inválidos → error 400              │
   │    con detalles del error                  │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Procedure Handler                          │
   │                                            │
   │  async ({ input, ctx }) => {               │
   │    const producto = {                      │
   │      id: nanoid(),                         │
   │      ...input,                             │
   │      tenantId: ctx.tenantId,               │
   │      createdAt: now(),                     │
   │    };                                      │
   │                                            │
   │    await ctx.db.insert(products)           │
   │      .values(producto);                    │
   │                                            │
   │    return producto;                        │
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
                    │ { id, nombre, precio, ... }
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Cliente tRPC                               │
   │ • Parsea respuesta                         │
   │ • Valida tipos                             │
   │ • Actualiza cache (TanStack Query)         │
   └────────────────┬───────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ Componente React                           │
   │ • onSuccess callback ejecutado             │
   │ • UI actualizado automáticamente           │
   │ • Producto aparece en lista                │
   └────────────────────────────────────────────┘
```

## Comparación: REST vs tRPC

### ACTUAL (REST)

```typescript
// ❌ BACKEND - Definir tipos manualmente
interface Product {
  id: string;
  name: string;
  price: number;
}

app.post('/api/collections/products', async (req, res) => {
  // Sin validación automática
  const data = req.body;
  
  // Sin type checking
  const product = await db.insert(products).values(data);
  res.send(product);
});

// ❌ FRONTEND - Duplicar tipos
interface Product {  // ⚠️ Duplicado!
  id: string;
  name: string;
  price: number;
}

// ❌ Definir función API manualmente
export async function createProduct(data: CreateProductData): Promise<Product> {
  const response = await fetch('/api/collections/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return response.json();
}

// ❌ Crear hook manualmente
export function useCreateProduct() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['products']);
    },
  });
}

// ❌ Usar en componente (sin type checking)
const crear = useCreateProduct();
crear.mutate({ nam: 'Coffee' });  // ⚠️ Error solo en runtime!
```

**Problemas:**
- 3 archivos que mantener
- Tipos duplicados
- Sin validación automática
- Errores solo en runtime
- ~150 líneas de código

---

### PROPUESTO (tRPC)

```typescript
// ✅ BACKEND - Definir una sola vez
const esquemaProducto = z.object({
  nombre: z.string(),
  precio: z.number(),
  sku: z.string(),
});

export const routerProductos = enrutador({
  crear: procedimientoTenant
    .input(esquemaProducto)  // ✅ Validación automática
    .mutation(async ({ input, ctx }) => {
      // ✅ input está validado y tipado
      const producto = await ctx.db.insert(products).values(input);
      return producto;  // ✅ Tipo inferido automáticamente
    }),
});

// ✅ FRONTEND - Solo importar tipo
import { clienteAPI } from '@/lib/trpc';

// ✅ Hook generado automáticamente
const crear = clienteAPI.productos.crear.useMutation();

// ✅ Usar en componente (type checking completo)
crear.mutate({ 
  nombre: 'Coffee',  // ✅ TypeScript valida
  precio: 2.50,
  sku: 'CAF-001'
});

crear.mutate({ 
  nam: 'Coffee'  // ❌ Error de TypeScript INMEDIATO
});
```

**Ventajas:**
- 2 archivos que mantener
- Tipos definidos una vez
- Validación automática con Zod
- Errores en compile-time
- ~30 líneas de código

**Reducción: 80% menos código, 100% más seguro**

## Estructura de Archivos Propuesta

```
open_yojob/
├── packages/server/
│   └── src/
│       ├── api-trpc/                     # 🆕 Nueva carpeta tRPC
│       │   ├── inicializador.ts          # Setup base tRPC
│       │   ├── contexto-peticion.ts      # Context con DB, user, tenant
│       │   ├── enrutador-raiz.ts         # Router principal
│       │   ├── middleware/
│       │   │   ├── autenticacion.ts      # JWT verification
│       │   │   └── tenant-guard.ts       # Tenant isolation
│       │   ├── dominios/                 # Routers por dominio
│       │   │   ├── productos.ts          # CRUD productos
│       │   │   ├── categorias.ts
│       │   │   ├── clientes.ts
│       │   │   ├── ventas.ts
│       │   │   └── inventario.ts
│       │   └── utilidades/
│       │       ├── esquemas-productos.ts  # Zod schemas
│       │       ├── esquemas-clientes.ts
│       │       └── esquemas-comunes.ts
│       ├── routes/                       # 📦 Mantener por ahora (legacy)
│       │   ├── auth.ts
│       │   ├── collections.ts
│       │   └── sync.ts
│       └── index.ts                      # ✏️ Modificar: agregar tRPC adapter
│
└── apps/web/
    └── src/
        ├── infraestructura/
        │   └── cliente-trpc.ts           # 🆕 Cliente tRPC configurado
        ├── hooks/
        │   └── api/
        │       ├── ganchos-productos-trpc.ts  # 🆕 Hooks tRPC
        │       ├── ganchos-clientes-trpc.ts
        │       ├── useProducts.ts        # 📦 Mantener temporalmente
        │       └── useCustomers.ts       # 📦 Mantener temporalmente
        ├── services/
        │   └── api/
        │       ├── client.ts             # 📦 Simplificar después
        │       ├── products.ts           # ❌ Eliminar en Fase 4
        │       └── customers.ts          # ❌ Eliminar en Fase 4
        └── App.tsx                       # ✏️ Modificar: agregar tRPC Provider
```

**Leyenda:**
- 🆕 = Archivos nuevos
- ✏️ = Archivos a modificar
- 📦 = Mantener temporalmente (migración gradual)
- ❌ = Eliminar en Fase 4 (limpieza final)

## Beneficios Visualizados

```
┌─────────────────────────────────────────────────────────┐
│                BENEFICIOS DE tRPC                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. TYPE SAFETY END-TO-END                              │
│     ┌────────┐                    ┌────────┐           │
│     │ Server │ ══════════════════►│ Client │           │
│     └────────┘   Tipos fluyen     └────────┘           │
│                  automáticamente                        │
│                                                         │
│  2. MENOS CÓDIGO                                        │
│     ANTES: ~150 líneas/colección                        │
│     ╔════════════════════════════════════╗              │
│     ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║              │
│     ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║              │
│     ║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║              │
│     ╚════════════════════════════════════╝              │
│                                                         │
│     DESPUÉS: ~30 líneas/colección (-80%)                │
│     ╔═══════╗                                           │
│     ║░░░░░░░║                                           │
│     ╚═══════╝                                           │
│                                                         │
│  3. ERRORES DETECTADOS ANTES                            │
│     Runtime Errors:  ▓▓▓▓▓▓▓▓▓▓ (10)                    │
│     Compile Errors:  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (20)          │
│     ✅ Mejor detectar en compilación que en producción   │
│                                                         │
│  4. DEVELOPER EXPERIENCE                                │
│     ANTES:                                              │
│     ┌─────────────┐                                     │
│     │ No IntelliSense                                   │
│     │ Tipos manuales                                    │
│     │ Errores en runtime                                │
│     └─────────────┘                                     │
│                                                         │
│     DESPUÉS:                                            │
│     ┌─────────────┐                                     │
│     │ ✅ IntelliSense completo                          │
│     │ ✅ Tipos automáticos                              │
│     │ ✅ Errores en compile-time                        │
│     │ ✅ Refactoring seguro                             │
│     └─────────────┘                                     │
│                                                         │
│  5. MANTENIBILIDAD                                      │
│     Archivos por colección:                             │
│     ANTES: 3 archivos (~250 líneas)                     │
│     DESPUÉS: 2 archivos (~80 líneas)                    │
│     ✅ 68% menos código que mantener                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

**Documento**: Arquitectura y Flujos tRPC  
**Fecha**: Febrero 2026  
**Versión**: 1.0  
**Estado**: Referencia técnica para implementación