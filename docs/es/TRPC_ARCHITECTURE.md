# Arquitectura tRPC

**Idioma:** Español · [English](../TRPC_ARCHITECTURE.md)

`/api/trpc` es la API canónica de Puntovivo. Fastify controla la ejecución,
tRPC los procedimientos tipados y el cliente React infiere solicitudes y
respuestas desde `AppRouter`.

## Organización

- Router raíz: `packages/server/src/trpc/router.ts`.
- Contexto: `packages/server/src/trpc/context.ts`.
- Esquemas: `packages/server/src/trpc/schemas/`.
- Routers: `packages/server/src/trpc/routers/`.
- Middleware: `packages/server/src/trpc/middleware/`.
- Cliente web: `apps/web/src/lib/trpc.ts`.

Mantén los routers pequeños: validan entradas, componen middleware compartido,
llaman a una función de aplicación/servicio y proyectan la respuesta de
transporte. Los flujos de negocio de varios pasos pertenecen a
`packages/server/src/application/`; las reglas de dominio reutilizables, a
`packages/server/src/services/`.

## Límites de procedimientos

- Cada procedimiento del negocio deriva `tenantId` del contexto autenticado.
- Usa controles de rol compartidos; no crees middleware de rol local al router.
- Las entradas con `siteId` llaman a `ensureTenantSite` antes de leer o escribir.
- Las funciones condicionadas por módulo componen controles de rol, negocio y módulo.
- Las mutaciones financieras conservan invariantes de sesión de caja activa
  y sobre de comando cuando corresponde.
- Los totales de listas paginadas repiten todos los joins y predicados de
  visibilidad de la consulta de filas.

## Transporte y errores

Los esquemas Zod son el límite de entrada. Los procedimientos lanzan códigos
estables del servidor; el renderer los localiza sin depender de su texto.
`/api/health` sigue siendo el endpoint de salud compatible y `/api/realtime/*`
la superficie SSE; las funciones nuevas no agregan APIs REST paralelas.

## Transacciones y efectos externos

El estado de base y su intención de diario/bandeja se escriben en una sola
transacción local. Los efectos fiscales, pagos, webhooks, sincronización y
hardware se ejecutan desde colas persistentes. Reintentar conserva idempotencia
y propiedad del negocio/sede.

## Comportamiento del cliente

React Query controla la caché del servidor. Las mutaciones invalidan las
superficies exactas que muestran su resultado; una comprobación en vivo debe
probar el recorrido completo de cambios visibles. El renderer nunca llama
módulos del servidor directamente y Electron permanece aislado tras IPC preload.

## Pruebas

Las pruebas del servidor llaman a `appRouter.createCaller(...)` contra SQLite
en memoria; no asignan puertos. Reutiliza los patrones de varios negocios y
roles de las pruebas existentes. Los comandos y requisitos de comprobación en
vivo están en [`TESTING.md`](../TESTING.md); los ejemplos específicos, en
[`TRPC_TESTING_GUIDE.md`](../TRPC_TESTING_GUIDE.md).
