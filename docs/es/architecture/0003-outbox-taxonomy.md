# 0003: taxonomía de bandejas

**Idioma:** Español · [English](../../architecture/0003-outbox-taxonomy.md)

> Estado: aceptada
> Fecha: 2 de mayo de 2026
> Contrato actual de workers y esquema revisado: 15 de octubre de 2026

## Decisión

La distribución operativa usa seis colas específicas: `sync_outbox`,
`fiscal_outbox`, `payment_outbox`, `webhook_outbox`, `hardware_outbox` y
`kds_outbox`. Sus tablas físicas, estados, reintentos y recuperación permanecen
separados. Un proveedor detenido no bloquea otra cola ni revierte una venta confirmada.

La implementación genérica en `packages/server/src/lib/outbox/` comparte
proyección `OutboxRow<TPayload>`, `createOutboxKernel`, `tickOutbox` y liquidación
protegida por propiedad. No obliga a usar una tabla ni un enum de estados para todos.
La proyección es:

```ts
interface OutboxRow<TPayload, TStatus extends string = string> {
  id: string;
  tenantId: string;
  status: TStatus;
  payload: TPayload;
  payloadVersion: number;
  attempts: number;
  nextRetryAt: string | null;
  lastError: NormalizedOutboxError | null;
  priority: number;
  claimToken: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## Límites de colas

| Cola              | Propósito y límite actual                                                                                                                            | Estados                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `sync_outbox`     | Intención de dominio del negocio; el push actual confirma intención local, no entrega atómica en otra base. Recuperación manual según ADR-0004/0005. | `queued`, `submitting`, `synced`, `conflict`, `retrying`, `dead_letter` y terminal `local_only` si se prohíbe transportar. |
| `fiscal_outbox`   | Comunicación de proveedor de un documento inmutable; mock/borrador local no certifica autoridad.                                                     | `queued`, `submitting`, `accepted`, `rejected`, `contingency`, `retrying`, `dead_letter`.                                  |
| `payment_outbox`  | Intención de medio de pago y conciliación; el contrato no homologa terminal ni proveedor real.                                                       | `queued`, `submitting`, `approved`, `declined`, `timeout`, `retrying`, `settled`, `dead_letter`.                           |
| `webhook_outbox`  | Eventos salientes firmados a receptor HTTPS aprovisionado; el worker HTTP está implementado.                                                         | `queued`, `submitting`, `delivered`, `failed`, `retrying`, `dead_letter`.                                                  |
| `hardware_outbox` | Efectos recuperables de recibo/cajón tras la transacción; no implica USB/serie directo.                                                              | `queued`, `submitting`, `printed`, `failed`, `retrying`, `dead_letter`.                                                    |
| `kds_outbox`      | Invalidación de cocina de un evento ya persistido, nunca otra venta o preparación.                                                                   | `queued`, `submitting`, `delivered`, `retrying`, `dead_letter`.                                                            |

KDS usa worker propio protegido por claim y no agrega un tipo al enum genérico
`OutboxKind`. `outbox_metadata` agrega actualmente cinco tipos: `sync`, `fiscal`,
`payment`, `webhook` y `hardware`; no demuestra que incluya toda cola dedicada.
Las alertas operativas también tienen cola dedicada y registro inmutable de
intentos; consulta [observabilidad](../../OBSERVABILITY.md) y [webhooks](../../WEBHOOKS.md).

Dinero, fiscalidad y caja no heredan reintentos de sincronización visual.
Operaciones ofrece recuperación por dominio sin exigir éxito de red para
confirmar el comando local original.

## Límite fiscal

`fiscal_documents` conserva evidencia; `fiscal_outbox` orquesta comunicación.
`kind` distingue `emit`, `cancel`, `retry_contingency` y `fetch_status`.
`contingency` conserva la venta local mientras espera al proveedor; no prueba
certificación legal de contingencia del pack de país.

El backoff genérico acotado es 1 minuto, 5 minutos, 15 minutos, 1 hora, 6 horas
y 24 horas, con presupuesto finito y recuperación `dead_letter`. Cada worker
elige política; hardware usa `BOUNDED_EXPONENTIAL_BACKOFF` y webhooks otra
programación documentada. No infieras hardware desde un comentario antiguo
sin backoff de un archivo de tipos compartidos.

Los errores normalizados llevan `errorCode`, `providerMessage`, `recoverable`
y `details` opcional. Errores públicos y diagnósticos siguen aplicando ocultamiento.
Un adaptador devuelve `FiscalAdapterIssueResult`, no controla la cola.
Identidad de proveedor, `fiscal_document_id` y `cufe` son fiscales, no columnas
de sync genéricas. Espejos de documento y eventos aceptados avanzan solo dentro
de la liquidación del claim actual.

## Propiedad de lease y liquidación

Workers genéricos fiscales, hardware, webhooks y alertas solo confirman su claim
actual del negocio. El ID de fila no acredita propiedad. Un resultado tardío
devuelve `lost_claim` sin cambiar intentos, entrega, documento, CUFE ni salud.

Efectos finales y confirmación comparten transacción SQLite inmediata síncrona.
Progreso intermedio por suscriptor e intentos de alerta usan el mismo límite.
La red queda fuera del escritor. Un error SQL local no es rechazo de proveedor.
Eventos públicos/metadatos opcionales fallan dentro de savepoints de mejor
esfuerzo sin provocar otra transmisión fiscal. Consulta
[el patrón del núcleo](../../architecture/patterns/outbox-kernel.md#fenced-settlement-and-intermediate-progress).

Los efectos externos se entregan al menos una vez: puede perderse propiedad
después de aceptar el proveedor. Ni `delivered` ni `printed` homologan recepción
física de pantalla/impresora. Polling y reconexión KDS recuperan pantallas
sin crear otra preparación. Consulta [ADR-0021](../../architecture/0021-durable-kitchen-preparation.md).

## Alternativas rechazadas

- **Una tabla con discriminador `kind`:** acopla consultas, estados y recuperación de colas distintas.
- **Bus solo en memoria:** pierde intención al fallar Electron, reiniciar SO o terminar proceso.
- **Cola por procedimiento:** multiplica tablas y oculta salud por dominio.
- **Kafka/RabbitMQ/Redis para completar localmente:** viola ADR-0001; una caja
  no depende de un broker de red para confirmar venta local.

## Implementación y compatibilidad

- `packages/server/src/lib/outbox/` controla claims, reintentos, liquidación y
  metadatos. Workers concretos eligen tabla, estado y política.
- `services/sync/contract.ts` y `enqueueSync` controlan intención;
  `sync.{getContract, peekOutbox, retry}` ofrece lectura/recuperación acotada.
- `0016_sync_contract_v1.sql` copió pendientes `sync_queue` mediante
  `INSERT OR IGNORE`; `0017_drop_sync_queue.sql` retiró la tabla tras cambiar
  escritores/procedimientos. La cola web pasó de `services/storage/syncQueue.ts`
  a `offlineQueue.ts`, manteniendo nombre compatible de store IndexedDB.
- `0018_hardware_outbox_idempotency.sql` agregó `idempotency_key` e índice parcial
  `(tenant_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL`.
  `packages/server/src/services/peripherals/enqueue-hardware.ts` devuelve
  `{deduped: true}` al repetir sobre; trabajos heredados sin clave siguen independientes.
  `peripherals.printReceipt` y `peripherals.kickCashDrawer` lo usan al encolar en servidor.
- `services/peripherals/hardware-worker.ts` conserva bytes en cola al reintentar.
  Cambiar ruta no completa silenciosamente un ESC/POS como impresión Sistema.
- `operation_events`, `operation_effects` y `operation_errors` ofrecen
  observabilidad en `packages/server/src/services/operation-journal/`; no sustituyen
  auditoría autoritativa ni escritura de bandeja del dominio.
- Los detalles reutilizables están en [Diario de operaciones](../../architecture/patterns/operation-journal.md)
  y [Núcleo de bandejas](../../architecture/patterns/outbox-kernel.md). Proveedores/terminales y
  hardware físico requieren evidencia separada de release.
