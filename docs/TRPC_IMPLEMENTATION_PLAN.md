# Plan de Implementación tRPC para Open Yojob

## Introducción

Este documento detalla el plan paso a paso para integrar tRPC en el proyecto Open Yojob, basado en el análisis positivo realizado. La implementación se dividirá en fases incrementales para minimizar riesgos y permitir validación continua.

---

## Resumen del Plan

| Fase | Duración | Objetivo | Riesgo |
|------|----------|----------|--------|
| Fase 1: Configuración Base | 2-3 días | Setup de tRPC y PoC mínimo | Bajo |
| Fase 2: Migración Colección Piloto | 3-4 días | Productos migrados completamente | Medio |
| Fase 3: Migración Colecciones Restantes | 1-2 semanas | Todas las colecciones | Bajo |
| Fase 4: Optimización y Limpieza | 3-4 días | Remover código legacy | Bajo |

**Tiempo Total Estimado**: 3-4 semanas

---

## Fase 1: Configuración Base (2-3 días)

### Objetivo
Configurar la infraestructura base de tRPC sin afectar el código existente.

### Tareas

#### 1.1 Instalar Dependencias

```bash
# En el paquete server
cd packages/server
npm install @trpc/server zod

# En la aplicación web
cd ../../apps/web
npm install @trpc/client @trpc/react-query @trpc/server
```

#### 1.2 Crear Estructura de Carpetas

```bash
# En packages/server/src/
mkdir -p api-trpc/{middleware,dominios,utilidades}

# Estructura resultante:
# packages/server/src/api-trpc/
# ├── inicializador.ts          # Inicialización base de tRPC
# ├── contexto-peticion.ts      # Context con DB, usuario, tenant
# ├── enrutador-raiz.ts          # Router principal que combina todos
# ├── middleware/
# │   ├── autenticacion.ts      # Verificación de JWT
# │   └── tenant-guard.ts       # Aislamiento por tenant
# ├── dominios/
# │   └── (vacío por ahora)
# └── utilidades/
#     └── esquemas-comunes.ts   # Schemas Zod reutilizables
```

#### 1.3 Configurar Inicializador tRPC Base

Crear `packages/server/src/api-trpc/inicializador.ts`:

```typescript
import { initTRPC } from '@trpc/server';
import type { ContextoPeticion } from './contexto-peticion.js';

const configuradorTRPC = initTRPC.context<ContextoPeticion>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        codigoError: error.code,
      },
    };
  },
});

export const enrutador = configuradorTRPC.router;
export const procedimientoPublico = configuradorTRPC.procedure;
export const middleware = configuradorTRPC.middleware;
```

#### 1.4 Configurar Contexto de Petición

Crear `packages/server/src/api-trpc/contexto-peticion.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../db/index.js';

export interface ContextoPeticion {
  solicitud: FastifyRequest;
  respuesta: FastifyReply;
  baseDatos: DatabaseInstance;
  usuarioActual: {
    id: string;
    email: string;
    rol: string;
    idTenant: string;
  } | null;
  idTenant: string | null;
}

export async function crearContextoPeticion({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<ContextoPeticion> {
  let usuarioActual = null;
  let idTenant = null;

  // Intentar extraer usuario del JWT si existe
  try {
    await req.jwtVerify();
    const payload = req.user as any;
    usuarioActual = {
      id: payload.userId,
      email: payload.email,
      rol: payload.role,
      idTenant: payload.tenantId,
    };
    idTenant = payload.tenantId;
  } catch {
    // Sin token válido - permitir procedimientos públicos
  }

  return {
    solicitud: req,
    respuesta: res,
    baseDatos: req.server.db,
    usuarioActual,
    idTenant,
  };
}
```

#### 1.5 Crear Middlewares de Autenticación

Crear `packages/server/src/api-trpc/middleware/autenticacion.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { middleware, procedimientoPublico } from '../inicializador.js';

const verificarAutenticacion = middleware(async ({ ctx, next }) => {
  if (!ctx.usuarioActual) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Debes iniciar sesión para realizar esta acción',
    });
  }

  return next({
    ctx: {
      ...ctx,
      usuarioActual: ctx.usuarioActual, // Ya verificado que no es null
    },
  });
});

export const procedimientoProtegido = procedimientoPublico.use(verificarAutenticacion);
```

Crear `packages/server/src/api-trpc/middleware/tenant-guard.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { middleware } from '../inicializador.js';
import { procedimientoProtegido } from './autenticacion.js';

const verificarTenant = middleware(async ({ ctx, next }) => {
  if (!ctx.idTenant) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Acceso restringido - requiere contexto de tenant',
    });
  }

  return next({
    ctx: {
      ...ctx,
      idTenant: ctx.idTenant, // Ya verificado que no es null
    },
  });
});

export const procedimientoTenant = procedimientoProtegido.use(verificarTenant);
```

#### 1.6 Crear Router Raíz Básico

Crear `packages/server/src/api-trpc/enrutador-raiz.ts`:

```typescript
import { enrutador } from './inicializador.js';

// Por ahora, router vacío
export const enrutadorRaiz = enrutador({
  // Los dominios se agregarán aquí
});

export type EnrutadorRaiz = typeof enrutadorRaiz;
```

#### 1.7 Integrar con Fastify

Modificar `packages/server/src/index.ts` para agregar el adaptador de tRPC:

```typescript
// Agregar imports
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { enrutadorRaiz } from './api-trpc/enrutador-raiz.js';
import { crearContextoPeticion } from './api-trpc/contexto-peticion.js';

// En la función createServer, después de registrar JWT y antes de routes REST:
  
  // Registrar tRPC
  await app.register(fastifyTRPCPlugin, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: enrutadorRaiz,
      createContext: crearContextoPeticion,
      onError({ path, error }) {
        console.error(`[tRPC] Error en ${path ?? 'unknown'}:`, error);
      },
    },
  });

  // ... registrar routes REST existentes (mantener por ahora)
```

#### 1.8 Configurar Cliente tRPC en Frontend

Crear `apps/web/src/infraestructura/cliente-trpc.ts`:

```typescript
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import type { EnrutadorRaiz } from '@open-yojob/server';

const URL_API = import.meta.env.VITE_API_URL || 'http://localhost:8090';

// Cliente React para hooks
export const clienteAPI = createTRPCReact<EnrutadorRaiz>();

// Cliente vanilla para uso fuera de componentes React
export const clienteVanilla = createTRPCClient<EnrutadorRaiz>({
  links: [
    httpBatchLink({
      url: `${URL_API}/api/trpc`,
      headers() {
        const token = localStorage.getItem('auth_token');
        return token ? { authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
```

#### 1.9 Configurar Provider en App

Modificar `apps/web/src/App.tsx`:

```typescript
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { clienteAPI } from './infraestructura/cliente-trpc';

function App() {
  const [queryClient] = useState(() => new QueryClient());
  const [clienteTRPC] = useState(() =>
    clienteAPI.createClient({
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
    <clienteAPI.Provider client={clienteTRPC} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* Resto de la app */}
      </QueryClientProvider>
    </clienteAPI.Provider>
  );
}
```

#### 1.10 Verificar Setup

Crear un procedimiento de prueba simple:

```typescript
// En enrutador-raiz.ts
export const enrutadorRaiz = enrutador({
  salud: enrutador({
    verificar: procedimientoPublico.query(() => {
      return { 
        estado: 'ok', 
        timestamp: new Date().toISOString(),
        mensaje: 'tRPC funcionando correctamente'
      };
    }),
  }),
});
```

Probar en frontend:

```typescript
// En cualquier componente
const { data } = clienteAPI.salud.verificar.useQuery();
console.log(data); // Debería mostrar el objeto con tipado completo
```

### Criterios de Éxito Fase 1
- ✅ tRPC instalado en servidor y cliente
- ✅ Contexto configurado con DB y autenticación
- ✅ Middlewares de auth funcionando
- ✅ Router integrado en Fastify
- ✅ Cliente React configurado
- ✅ Procedimiento de prueba funciona end-to-end

---

## Fase 2: Migración Colección Piloto - Productos (3-4 días)

### Objetivo
Migrar completamente la colección de productos a tRPC como prueba de concepto.

### 2.1 Crear Esquemas de Validación

Crear `packages/server/src/api-trpc/utilidades/esquemas-productos.ts`:

```typescript
import { z } from 'zod';

export const esquemaProductoBase = z.object({
  nombre: z.string().min(1, 'El nombre es requerido').max(100),
  codigoSKU: z.string().min(1).max(50),
  descripcion: z.string().optional(),
  idCategoria: z.string(),
  precio: z.number().positive('El precio debe ser positivo'),
  costo: z.number().nonnegative('El costo no puede ser negativo'),
  tasaImpuesto: z.number().min(0).max(100),
  stock: z.number().int().nonnegative().default(0),
  stockMinimo: z.number().int().nonnegative().default(0),
  activo: z.boolean().default(true),
  codigoBarras: z.string().optional(),
  urlImagen: z.string().url().optional().or(z.literal('')),
});

export const esquemaCrearProducto = esquemaProductoBase;

export const esquemaActualizarProducto = esquemaProductoBase.partial();

export const esquemaConsultarProducto = z.object({
  id: z.string(),
});

export const esquemaListarProductos = z.object({
  pagina: z.number().int().positive().default(1),
  porPagina: z.number().int().min(1).max(100).default(50),
  busqueda: z.string().optional(),
  idCategoria: z.string().optional(),
  activo: z.boolean().optional(),
  ordenar: z.enum(['nombre', 'precio', 'stock', 'createdAt']).default('createdAt'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});
```

### 2.2 Crear Router de Productos

Crear `packages/server/src/api-trpc/dominios/productos.ts`:

```typescript
import { eq, and, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { enrutador } from '../inicializador.js';
import { procedimientoTenant } from '../middleware/tenant-guard.js';
import { products, syncQueue } from '../../db/schema.js';
import {
  esquemaListarProductos,
  esquemaConsultarProducto,
  esquemaCrearProducto,
  esquemaActualizarProducto,
} from '../utilidades/esquemas-productos.js';

export const routerProductos = enrutador({
  listar: procedimientoTenant
    .input(esquemaListarProductos)
    .query(async ({ input: parametros, ctx: contexto }) => {
      const { pagina, porPagina, busqueda, idCategoria, activo, ordenar, direccion } = parametros;
      
      const desplazamiento = (pagina - 1) * porPagina;
      
      // Construir condiciones WHERE
      const condiciones = [eq(products.tenantId, contexto.idTenant)];
      
      if (busqueda) {
        condiciones.push(
          or(
            like(products.name, `%${busqueda}%`),
            like(products.sku, `%${busqueda}%`),
            like(products.barcode, `%${busqueda}%`)
          ) as any
        );
      }
      
      if (idCategoria) {
        condiciones.push(eq(products.categoryId, idCategoria));
      }
      
      if (activo !== undefined) {
        condiciones.push(eq(products.isActive, activo));
      }
      
      // Obtener total
      const [conteoResult] = await contexto.baseDatos
        .select({ total: sql<number>`count(*)` })
        .from(products)
        .where(and(...condiciones));
      
      const totalElementos = conteoResult?.total ?? 0;
      const totalPaginas = Math.ceil(totalElementos / porPagina);
      
      // Obtener elementos
      const elementos = await contexto.baseDatos
        .select()
        .from(products)
        .where(and(...condiciones))
        .limit(porPagina)
        .offset(desplazamiento)
        .orderBy(
          direccion === 'asc' 
            ? sql`${products[ordenar]} ASC` 
            : sql`${products[ordenar]} DESC`
        );
      
      return {
        elementos,
        paginacion: {
          pagina,
          porPagina,
          totalElementos,
          totalPaginas,
        },
      };
    }),

  consultarPorId: procedimientoTenant
    .input(esquemaConsultarProducto)
    .query(async ({ input: { id }, ctx: contexto }) => {
      const [producto] = await contexto.baseDatos
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.tenantId, contexto.idTenant)
          )
        )
        .limit(1);
      
      if (!producto) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Producto no encontrado',
        });
      }
      
      return producto;
    }),

  crear: procedimientoTenant
    .input(esquemaCrearProducto)
    .mutation(async ({ input: datos, ctx: contexto }) => {
      const ahora = new Date().toISOString();
      const nuevoId = nanoid();
      
      const nuevoProducto = {
        id: nuevoId,
        ...datos,
        tenantId: contexto.idTenant,
        syncStatus: 'pending' as const,
        syncVersion: 1,
        createdAt: ahora,
        updatedAt: ahora,
      };
      
      await contexto.baseDatos.insert(products).values(nuevoProducto);
      
      // Agregar a cola de sync
      await contexto.baseDatos.insert(syncQueue).values({
        id: nanoid(),
        tenantId: contexto.idTenant,
        entityType: 'products',
        entityId: nuevoId,
        operation: 'create',
        data: nuevoProducto,
        localVersion: 1,
        attempts: 0,
        createdAt: ahora,
      });
      
      // Emitir evento SSE (si está configurado)
      if (contexto.solicitud.server.sse) {
        contexto.solicitud.server.sse.broadcast('products.create', nuevoProducto);
      }
      
      return nuevoProducto;
    }),

  actualizar: procedimientoTenant
    .input(z.object({
      id: z.string(),
      datos: esquemaActualizarProducto,
    }))
    .mutation(async ({ input: { id, datos }, ctx: contexto }) => {
      // Verificar que existe y pertenece al tenant
      const [existente] = await contexto.baseDatos
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.tenantId, contexto.idTenant)
          )
        )
        .limit(1);
      
      if (!existente) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Producto no encontrado',
        });
      }
      
      const ahora = new Date().toISOString();
      const datosActualizados = {
        ...datos,
        syncStatus: 'pending' as const,
        syncVersion: existente.syncVersion + 1,
        updatedAt: ahora,
      };
      
      await contexto.baseDatos
        .update(products)
        .set(datosActualizados)
        .where(eq(products.id, id));
      
      // Agregar a cola de sync
      await contexto.baseDatos.insert(syncQueue).values({
        id: nanoid(),
        tenantId: contexto.idTenant,
        entityType: 'products',
        entityId: id,
        operation: 'update',
        data: datosActualizados,
        localVersion: existente.syncVersion + 1,
        attempts: 0,
        createdAt: ahora,
      });
      
      // Emitir evento SSE
      if (contexto.solicitud.server.sse) {
        contexto.solicitud.server.sse.broadcast('products.update', {
          id,
          ...datosActualizados,
        });
      }
      
      // Retornar producto actualizado
      const [productoActualizado] = await contexto.baseDatos
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);
      
      return productoActualizado!;
    }),

  eliminar: procedimientoTenant
    .input(esquemaConsultarProducto)
    .mutation(async ({ input: { id }, ctx: contexto }) => {
      // Solo admins pueden eliminar
      if (contexto.usuarioActual.rol !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Solo los administradores pueden eliminar productos',
        });
      }
      
      // Verificar que existe y pertenece al tenant
      const [existente] = await contexto.baseDatos
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.tenantId, contexto.idTenant)
          )
        )
        .limit(1);
      
      if (!existente) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Producto no encontrado',
        });
      }
      
      await contexto.baseDatos
        .delete(products)
        .where(eq(products.id, id));
      
      const ahora = new Date().toISOString();
      
      // Agregar a cola de sync
      await contexto.baseDatos.insert(syncQueue).values({
        id: nanoid(),
        tenantId: contexto.idTenant,
        entityType: 'products',
        entityId: id,
        operation: 'delete',
        data: { id },
        localVersion: 1,
        attempts: 0,
        createdAt: ahora,
      });
      
      // Emitir evento SSE
      if (contexto.solicitud.server.sse) {
        contexto.solicitud.server.sse.broadcast('products.delete', { id });
      }
      
      return { exito: true, id };
    }),
});
```

### 2.3 Agregar Router de Productos al Router Raíz

Modificar `packages/server/src/api-trpc/enrutador-raiz.ts`:

```typescript
import { enrutador } from './inicializador.js';
import { routerProductos } from './dominios/productos.js';

export const enrutadorRaiz = enrutador({
  salud: enrutador({
    verificar: procedimientoPublico.query(() => ({
      estado: 'ok',
      timestamp: new Date().toISOString(),
    })),
  }),
  productos: routerProductos,
});

export type EnrutadorRaiz = typeof enrutadorRaiz;
```

### 2.4 Crear Hooks React para Productos

Crear `apps/web/src/hooks/api/ganchos-productos-trpc.ts`:

```typescript
import { clienteAPI } from '@/infraestructura/cliente-trpc';

// Query hooks con nombres descriptivos
export const useListadoProductosTRPC = clienteAPI.productos.listar.useQuery;
export const useDetalleProductoTRPC = clienteAPI.productos.consultarPorId.useQuery;

// Mutation hooks
export const useCrearProductoTRPC = clienteAPI.productos.crear.useMutation;
export const useActualizarProductoTRPC = clienteAPI.productos.actualizar.useMutation;
export const useEliminarProductoTRPC = clienteAPI.productos.eliminar.useMutation;

// Hook personalizado con invalidación automática
export function useCrearProductoConInvalidacion() {
  const utils = clienteAPI.useUtils();
  
  return clienteAPI.productos.crear.useMutation({
    onSuccess: () => {
      // Invalidar lista de productos para refrescar
      utils.productos.listar.invalidate();
    },
  });
}

export function useActualizarProductoConInvalidacion() {
  const utils = clienteAPI.useUtils();
  
  return clienteAPI.productos.actualizar.useMutation({
    onSuccess: (datosActualizados) => {
      // Invalidar tanto la lista como el detalle específico
      utils.productos.listar.invalidate();
      utils.productos.consultarPorId.invalidate({ id: datosActualizados.id });
    },
  });
}

export function useEliminarProductoConInvalidacion() {
  const utils = clienteAPI.useUtils();
  
  return clienteAPI.productos.eliminar.useMutation({
    onSuccess: (_, { id }) => {
      utils.productos.listar.invalidate();
      utils.productos.consultarPorId.invalidate({ id });
    },
  });
}
```

### 2.5 Actualizar Componentes para Usar tRPC

Ejemplo de migración de componente:

```typescript
// ANTES (con API REST)
import { useProducts, useCreateProduct } from '@/hooks/api/useProducts';

function ListaProductos() {
  const { data, isLoading } = useProducts({ page: 1, perPage: 50 });
  const crearProducto = useCreateProduct();
  
  // ...
}

// DESPUÉS (con tRPC)
import { 
  useListadoProductosTRPC, 
  useCrearProductoConInvalidacion 
} from '@/hooks/api/ganchos-productos-trpc';

function ListaProductos() {
  const { data, isLoading } = useListadoProductosTRPC({ 
    pagina: 1, 
    porPagina: 50 
  });
  const crearProducto = useCrearProductoConInvalidacion();
  
  // Tipado automático - 'data' tiene tipo completo inferido
  // data.elementos es Product[]
  // data.paginacion tiene pagina, totalElementos, etc.
}
```

### 2.6 Pruebas End-to-End

1. **Prueba de lectura**: Verificar que la lista de productos se muestra correctamente
2. **Prueba de creación**: Crear un nuevo producto y verificar que aparece en la lista
3. **Prueba de actualización**: Modificar un producto y verificar cambios
4. **Prueba de eliminación**: Eliminar un producto (como admin)
5. **Prueba de tipos**: Verificar que TypeScript detecta errores en tiempo de compilación

### Criterios de Éxito Fase 2
- ✅ Router de productos completo con todas las operaciones CRUD
- ✅ Esquemas Zod validando correctamente la entrada
- ✅ Hooks React funcionando con tipado completo
- ✅ Componentes migrados funcionando sin errores
- ✅ Aislamiento de tenant funcionando correctamente
- ✅ Cola de sync funcionando
- ✅ API REST de productos puede coexistir (no eliminada aún)

---

## Fase 3: Migración Colecciones Restantes (1-2 semanas)

### Objetivo
Migrar las colecciones restantes usando el patrón establecido en Fase 2.

### Orden de Migración Sugerido

1. **Categorías** (1 día) - Simple, sin relaciones complejas
2. **Clientes** (1 día) - Similar a productos
3. **Ventas** (2 días) - Más complejo, incluye items de venta
4. **Inventario** (2 días) - Movimientos de inventario
5. **Autenticación** (1 día) - Migrar endpoints de auth

### Plantilla de Migración

Para cada colección, seguir este patrón:

1. **Crear esquemas** en `api-trpc/utilidades/esquemas-{coleccion}.ts`
2. **Crear router** en `api-trpc/dominios/{coleccion}.ts`
3. **Agregar al router raíz** en `enrutador-raiz.ts`
4. **Crear hooks React** en `hooks/api/ganchos-{coleccion}-trpc.ts`
5. **Migrar componentes** uno por uno
6. **Probar** funcionalidad end-to-end
7. **Documentar** cualquier particularidad

### Notas Específicas por Colección

#### Categorías
- Estructura de árbol (padre-hijo)
- Agregar procedimiento para obtener árbol completo
- Validar que no se creen ciclos

#### Clientes
- Similar a productos
- Agregar búsqueda por nombre, email, teléfono

#### Ventas
- Transaccional - crear venta + items en una sola mutación
- Usar transacciones de Drizzle
- Actualizar stock de productos automáticamente

```typescript
crearVenta: procedimientoTenant
  .input(esquemaCrearVenta)
  .mutation(async ({ input, ctx }) => {
    return ctx.baseDatos.transaction(async (transaccion) => {
      // 1. Crear venta
      const venta = await transaccion.insert(sales).values(/* ... */);
      
      // 2. Crear items de venta
      await transaccion.insert(saleItems).values(input.items);
      
      // 3. Actualizar stock de productos
      for (const item of input.items) {
        await transaccion
          .update(products)
          .set({ stock: sql`stock - ${item.quantity}` })
          .where(eq(products.id, item.productId));
      }
      
      return venta;
    });
  }),
```

#### Inventario
- Movimientos de entrada/salida
- Validar que hay stock suficiente para salidas
- Actualizar stock de productos

### Criterios de Éxito Fase 3
- ✅ Todas las colecciones migradas a tRPC
- ✅ Frontend completamente funcional con tRPC
- ✅ API REST aún disponible (no eliminada)
- ✅ Todas las pruebas pasando
- ✅ Performance equivalente o mejor que REST

---

## Fase 4: Optimización y Limpieza (3-4 días)

### Objetivo
Optimizar la implementación y remover código legacy.

### 4.1 Optimizaciones

#### Implementar Batching
El batching agrupa múltiples queries en una sola petición HTTP:

```typescript
// En cliente-trpc.ts
links: [
  httpBatchLink({
    url: `${URL_API}/api/trpc`,
    maxURLLength: 2083,
    // Las queries se agrupan automáticamente
  }),
],
```

#### Implementar Subscriptions (Reemplazar SSE)

```typescript
// En servidor
import { observable } from '@trpc/server/observable';

cambiosEnTiempoReal: procedimientoTenant
  .subscription(({ ctx }) => {
    return observable<CambioProducto>((emisor) => {
      const manejador = (cambio: CambioProducto) => {
        if (cambio.tenantId === ctx.idTenant) {
          emisor.next(cambio);
        }
      };
      
      eventosCambios.on('producto:cambio', manejador);
      
      return () => {
        eventosCambios.off('producto:cambio', manejador);
      };
    });
  }),

// En cliente
clienteAPI.productos.cambiosEnTiempoReal.useSubscription(undefined, {
  onData: (cambio) => {
    console.log('Cambio recibido:', cambio);
  },
  onError: (error) => {
    console.error('Error en subscripción:', error);
  },
});
```

### 4.2 Agregar tRPC Panel (Herramienta de Desarrollo)

```bash
npm install trpc-panel
```

```typescript
// En desarrollo, exponer tRPC Panel
if (process.env.NODE_ENV === 'development') {
  await app.register(import('@trpc/server/adapters/fastify'), {
    prefix: '/panel',
    trpcOptions: {
      router: enrutadorRaiz,
      createContext: crearContextoPeticion,
    },
  });
}
```

Acceder a `http://localhost:8090/panel` para explorar y probar la API visualmente.

### 4.3 Eliminar Código Legacy

Una vez validado que tRPC funciona correctamente:

1. **Eliminar servicios API REST antiguos**:
   - `apps/web/src/services/api/products.ts`
   - `apps/web/src/services/api/customers.ts`
   - Etc.

2. **Eliminar hooks antiguos**:
   - `apps/web/src/hooks/api/useProducts.ts`
   - `apps/web/src/hooks/api/useCustomers.ts`
   - Etc.

3. **Actualizar cliente API**:
   - Simplificar `apps/web/src/services/api/client.ts`
   - Mantener solo funciones de auth si es necesario

4. **Considerar eliminar routes REST del servidor** (o mantener para APIs externas):
   - `packages/server/src/routes/collections.ts` (si ya no se usa)

5. **Actualizar documentación**:
   - README.md
   - docs/ARCHITECTURE.md
   - Agregar ejemplos de uso de tRPC

### 4.4 Optimización de Bundle

Analizar tamaño del bundle:

```bash
cd apps/web
npm run build
# Analizar output

# Si es necesario, considerar:
# - Tree-shaking de dependencias no usadas
# - Code splitting de routers grandes
```

### Criterios de Éxito Fase 4
- ✅ Batching implementado y funcionando
- ✅ Subscriptions funcionando (si se implementan)
- ✅ tRPC Panel configurado para desarrollo
- ✅ Código legacy eliminado
- ✅ Documentación actualizada
- ✅ Bundle size aceptable (<500KB total)
- ✅ Performance igual o mejor que antes

---

## Pruebas y Validación

### Pruebas Funcionales

Crear suite de pruebas para cada router:

```typescript
// packages/server/src/api-trpc/__tests__/productos.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { crearContextosPrueba } from '../utilidades/test-helpers';
import { routerProductos } from '../dominios/productos';

describe('Router de Productos', () => {
  let contexto: ContextoPeticion;
  
  beforeEach(() => {
    contexto = crearContextosPrueba();
  });
  
  it('debería listar productos', async () => {
    const caller = routerProductos.createCaller(contexto);
    const resultado = await caller.listar({ pagina: 1, porPagina: 10 });
    
    expect(resultado.elementos).toBeInstanceOf(Array);
    expect(resultado.paginacion.totalElementos).toBeGreaterThanOrEqual(0);
  });
  
  it('debería crear un producto', async () => {
    const caller = routerProductos.createCaller(contexto);
    const nuevoProducto = await caller.crear({
      nombre: 'Producto de Prueba',
      codigoSKU: 'TEST-001',
      idCategoria: 'cat-123',
      precio: 10.99,
      costo: 5.00,
      tasaImpuesto: 16,
    });
    
    expect(nuevoProducto.id).toBeDefined();
    expect(nuevoProducto.nombre).toBe('Producto de Prueba');
  });
  
  it('debería rechazar creación con datos inválidos', async () => {
    const caller = routerProductos.createCaller(contexto);
    
    await expect(
      caller.crear({
        nombre: '', // Nombre vacío - inválido
        codigoSKU: 'TEST-001',
        idCategoria: 'cat-123',
        precio: -10, // Precio negativo - inválido
        costo: 5.00,
        tasaImpuesto: 16,
      })
    ).rejects.toThrow();
  });
});
```

### Pruebas de Integración

```typescript
// apps/web/src/__tests__/integracion/productos.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ListaProductos } from '@/features/productos/ListaProductos';

describe('Integración de Productos con tRPC', () => {
  it('debería cargar y mostrar productos', async () => {
    const queryClient = new QueryClient();
    
    render(
      <QueryClientProvider client={queryClient}>
        <ListaProductos />
      </QueryClientProvider>
    );
    
    await waitFor(() => {
      expect(screen.getByText(/productos/i)).toBeInTheDocument();
    });
  });
});
```

### Pruebas de Performance

Comparar performance antes y después:

```typescript
// Script de benchmark
async function benchmarkAPI() {
  console.time('REST API - 100 requests');
  for (let i = 0; i < 100; i++) {
    await fetch('http://localhost:8090/api/collections/products');
  }
  console.timeEnd('REST API - 100 requests');
  
  console.time('tRPC - 100 requests');
  for (let i = 0; i < 100; i++) {
    await clienteVanilla.productos.listar.query({ pagina: 1, porPagina: 50 });
  }
  console.timeEnd('tRPC - 100 requests');
  
  console.time('tRPC con batching - 100 requests');
  await Promise.all(
    Array.from({ length: 100 }, () =>
      clienteVanilla.productos.listar.query({ pagina: 1, porPagina: 50 })
    )
  );
  console.timeEnd('tRPC con batching - 100 requests');
}
```

---

## Gestión de Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Bugs durante migración | Media | Alto | Mantener REST en paralelo, migrar gradualmente |
| Curva de aprendizaje del equipo | Alta | Medio | Documentación, pair programming, training |
| Performance degradada | Baja | Alto | Benchmarks continuos, optimizaciones |
| Incompatibilidad con tools existentes | Baja | Medio | Pruebas exhaustivas, investigación previa |
| Aumento excesivo de bundle | Baja | Bajo | Tree-shaking, análisis de bundle |

---

## Rollback Plan

Si es necesario revertir la migración:

1. **Fase 1-2**: Simplemente desactivar tRPC en Fastify, el código REST sigue funcionando
2. **Fase 3**: Revertir componentes a usar hooks REST antiguos (aún disponibles)
3. **Fase 4**: Si ya se eliminó código legacy, usar Git para recuperarlo

```bash
# Revertir a commit antes de eliminar código legacy
git revert <commit-hash>

# O crear rama de respaldo antes de Fase 4
git branch respaldo-pre-limpieza
```

---

## Checklist de Implementación

### Preparación
- [ ] Equipo capacitado en conceptos básicos de tRPC
- [ ] Repositorio respaldado
- [ ] Pruebas existentes documentadas
- [ ] Plan de comunicación con stakeholders

### Fase 1: Setup
- [ ] Dependencias instaladas
- [ ] Estructura de carpetas creada
- [ ] Inicializador y contexto configurados
- [ ] Middlewares de auth implementados
- [ ] Router raíz creado
- [ ] Integración con Fastify completa
- [ ] Cliente React configurado
- [ ] Procedimiento de prueba funciona

### Fase 2: PoC Productos
- [ ] Esquemas Zod creados
- [ ] Router de productos implementado
- [ ] Hooks React creados
- [ ] Al menos un componente migrado
- [ ] Pruebas end-to-end pasando
- [ ] Performance aceptable
- [ ] Equipo valida implementación

### Fase 3: Migración Completa
- [ ] Categorías migradas
- [ ] Clientes migrados
- [ ] Ventas migradas
- [ ] Inventario migrado
- [ ] Autenticación migrada
- [ ] Todos los componentes actualizados
- [ ] Suite de pruebas actualizada

### Fase 4: Optimización
- [ ] Batching implementado
- [ ] Subscriptions evaluadas/implementadas
- [ ] tRPC Panel configurado
- [ ] Código legacy eliminado
- [ ] Documentación actualizada
- [ ] Bundle size optimizado
- [ ] Performance benchmarks completados

### Post-Implementación
- [ ] Monitoreo de errores en producción
- [ ] Feedback del equipo recopilado
- [ ] Lecciones aprendidas documentadas
- [ ] Plan de mejora continua establecido

---

## Recursos y Referencias

### Documentación
- **tRPC Oficial**: https://trpc.io/docs
- **Adaptador Fastify**: https://trpc.io/docs/server/adapters/fastify
- **React Query Integration**: https://trpc.io/docs/client/react
- **Zod Documentation**: https://zod.dev

### Herramientas de Desarrollo
- **tRPC Panel**: https://github.com/iway1/trpc-panel
- **tRPC Playground**: https://github.com/sachinraja/trpc-playground
- **tRPC Chrome Extension**: Para debugging

### Ejemplos y Templates
- Repositorio de ejemplos tRPC: https://github.com/trpc/examples-next-prisma-starter
- Ejemplos con Fastify: https://github.com/trpc/trpc/tree/main/examples/fastify-server

---

## Conclusión

Este plan proporciona una ruta clara y segura para migrar Open Yojob a tRPC. La migración gradual minimiza riesgos mientras que permite validar beneficios en cada fase.

**Próximo Paso**: Obtener aprobación del equipo y comenzar con Fase 1.

---

**Versión del Plan**: 1.0  
**Última Actualización**: Febrero 2026  
**Estado**: Propuesta - Pendiente de aprobación