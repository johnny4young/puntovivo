# `application/`: límite de casos de uso

**Idioma:** Español · [English](README.md)

> Estado: activo
> ADR complementarios: [ADR-0001](../../../../docs/architecture/0001-local-store-authority.md), [ADR-0002](../../../../docs/architecture/0002-command-envelope.md)

`application/` aloja el **límite estable de casos de uso** de operaciones críticas.
Cada subcarpeta controla un contexto acotado (`sales/`, `cash-sessions/`,
`inventory/`, ...) y expone una superficie pequeña invocable por tRPC, futuros
workers y pruebas sin repetir la orquestación.

## Motivo de esta capa

Mantener la orquestación dentro de un router de transporte acopla estas responsabilidades:

- Preparación de entradas: artículos, pagos y medios de pago.
- Comprobaciones: caja abierta, cliente válido y propiedad.
- Una llamada grande `db.transaction(...)` que escribe ocho tablas o más.
- Preparación de efectos persistentes, activaciones posteriores al commit y observabilidad.

Ese acoplamiento obliga a modificar dos o tres lugares ante una invariante
nueva, como otro medio de pago o regla de inventario, y a probar por tRPC una
operación que solo orquesta.

`application/` lo resuelve con una función asíncrona por caso de uso. El router
adapta sus entradas y devuelve el resultado de esa función.

## Qué pertenece a `application/` y a `services/`

| Lugar          | Contenido                                                         | Ejemplos                                                                                                                          |
| -------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `services/`    | **Primitivas** compartidas entre casos de uso.                    | `audit-logs.ts`, `idempotency/`, `operation-journal/`, `cash-session.ts` (helpers), `fraction-policy.ts`, `inventory-balances.ts` |
| `application/` | **Casos de uso** que orquestan primitivas tras un límite estable. | `sales/completeSale.ts`, `sales/voidSale.ts`, `sales/returnSale.ts`, `cash-sessions/openSession.ts`, ...                          |

Un caso de uso normalmente:

1. Valida entradas contra el estado actual de la base.
2. Abre una transacción que escribe todas las filas autoritativas afectadas,
   incluidas intenciones/bandejas persistentes necesarias para recuperación.
3. Tras confirmar emite efectos de diario de mejor esfuerzo y efectos posteriores
   de fiscalidad, hardware y futuras bandejas.

Una primitiva normalmente:

1. Recibe `tx` o `db` y el ámbito del negocio.
2. Escribe una o dos filas relacionadas.
3. Lanza o devuelve un resultado tipado; nunca controla su propia transacción.

## Organización por caso de uso

```
application/<feature>/
├── index.ts              # barrel re-export of the public surface
├── types.ts              # input + output + context types
├── policies.ts           # pure functions (no DB access)
├── <useCase>.ts          # orchestration entry point
└── journal-effects.ts    # best-effort journal effect emission
```

`policies.ts` y `journal-effects.ts` son opcionales: un caso pequeño puede
permanecer en un solo archivo. Extráelos cuando supere unas 500 líneas o cuando
varios casos de la misma función reutilicen políticas.

## Convención de pruebas

Las pruebas viven en
`packages/server/src/__tests__/application-<feature>-<useCase>.test.ts`.
Invocan directamente la función con un objeto de forma `Context` construido
en la prueba, **sin** iniciar Fastify ni pasar por tRPC. Las pruebas de forma
HTTP (`<feature>.test.ts`) se conservan para conexiones, autenticación, roles,
parseo y códigos de error; la cobertura de orquestación queda en la capa de aplicación.

## Implementación relacionada

- `sales/completeSale` completa ventas.
- `sales/voidSale`, `sales/returnSale` y `sales/discardDraft` controlan sus transiciones.
- `cash-sessions/` controla el agregado de sesión de caja.
- `inventory/` controla altas, movimientos, ajustes y transferencias; las consultas de transferencias/lecturas siguen en `services/`.
- `products/` controla creación/actualización; asignación de catálogo e hidratación viven en `services/products/`; tRPC conserva roles/entradas y baja lógica.
- `customers/` controla pagos y ajustes manuales del libro; saldos/entradas siguen en el router con controles manager/admin y escrituras solo de admin.
