# Patrón: núcleo de outbox

**Idioma:** Español · [English](../../../architecture/patterns/outbox-kernel.md)

> Estado: Activo
> ADR complementarios: [ADR-0003](../../../architecture/0003-outbox-taxonomy.md)
> Código: `packages/server/src/lib/outbox/`

El **núcleo de outbox** extrae el ciclo de vida mecánico de una cola asíncrona de distribución a varios destinos (tomar → procesar → completar | reintentar | enviar a cola de fallos definitivos) en una fábrica reutilizable. Las outboxes concretas fiscales, de hardware, de webhooks y de alertas operativas componen el núcleo con su propia tabla, enumeración de estados y política de reintentos; la invalidación de cocina usa su ruta separada de entrega síncrona protegida por propiedad. ADR-0003 también describe las outboxes de sincronización y pagos, cuyos workers actuales no componen este núcleo.

## Qué es

Una fábrica y una función de worker que abstraen:

- **Toma atómica** mediante el predicado `status` + `claim_token`: dos workers pueden consultar la misma outbox al mismo tiempo y solo uno gana por fila. Las confirmaciones requieren el mismo tenant, fila, estado de procesamiento y token de toma; un worker anterior no puede finalizar el intento de otro que lo reemplazó.
- **Estado de procesamiento explícito**: `claimNext()` mueve filas de `queued` o `retrying` ya vencido al estado de procesamiento de la outbox concreta (`submitting`, `processing`, etc.) y también establece el bloqueo del worker.
- **Presupuesto de reintentos** con una `OutboxRetryPolicy` por outbox: espera exponencial acotada predeterminada para fiscal y hardware, y una secuencia separada para webhooks.
- **Estados terminales del ciclo de vida**: cuando una fila llega a un estado terminal (`succeeded`, `dead_letter`, etc.), el núcleo rechaza transiciones adicionales.
- **Manejo de fallos recuperables frente a permanentes**: los errores no recuperables van de inmediato a la cola de fallos definitivos, sin importar el presupuesto restante.
- **Función de worker**: `tickOutbox()` ejecuta un ciclo de tomar → procesar → completar | fallar y expone el resultado al llamador, incluido `lost_claim` cuando una respuesta ha sido reemplazada.

El núcleo NO es responsable de:

- La tabla concreta de la outbox: cada outbox declara la suya con las columnas COMPARTIDAS (id, tenantId, status, payload, attempts, nextRetryAt, lastError, claimToken, lockedAt, etc.), más las adicionales por outbox (`fiscal_document_id`, `peripheral_id`, etc.).
- La enumeración de estados: las outboxes concretas tienen la suya (fiscal tiene `contingency`, pagos tiene `settled`, hardware tiene `failed`).
- El bucle del reloj: los workers pueden ejecutarse con `setInterval`, después de cada encolado o mediante un planificador estilo Bull. El núcleo solo expone `tickOutbox()` como unidad de trabajo.

## Por qué

Las outboxes concretas comparten mecanismos del ciclo de vida: toma, reintento, espera, cola de fallos definitivos y normalización del último error. ADR-0003 rechazó explícitamente «una outbox por procedimiento» y «una tabla de outbox monolítica»: el núcleo es la tercera vía. Cada outbox conserva su propia tabla (para que el esquema refleje las particularidades de cada ciclo de vida), pero hereda los mecanismos compartidos y conserva el manejo específico de los proveedores del dominio.

Sin el núcleo, cada worker que lo adopta volvería a implementar attempts++, el cálculo de nextRetryAt, las guardas de claim_token y las transiciones a fallos definitivos, creando copias que divergen con el tiempo. Con el núcleo, los mecanismos viven en un solo lugar y las outboxes concretas se concentran en la lógica de su dominio (la emisión fiscal real, la entrega a hardware o el POST de webhook).

## Ciclo de vida (forma fiscal ilustrativa de ADR-0003)

```
       enqueue
           │
           ▼
        ┌──────────┐
        │  queued  │◄──────────────── claimNext (ready row)
        └────┬─────┘
             │ claimNext()
             ▼
        ┌──────────────┐
        │  submitting  │
        └──────┬───────┘
               │
       ┌───────┴─────────┐
       ▼                 ▼
    process()         process()
    returns ok        returns fail
       │                 │
       │      ┌───── recoverable ─────┐
       ▼      ▼                       ▼
 ┌───────────┐  ┌────────────┐   ┌─────────────┐
 │ succeeded │  │  retrying  │   │ dead_letter │
 └───────────┘  └────┬───────┘   └─────────────┘
   (terminal)        │ nextRetryAt arrives
                     │
                     └─► claimNext picks it up again
```

El diagrama usa terminología genérica de éxito; el núcleo fiscal asigna el éxito a accepted. Los estados terminales se configuran por outbox (sin transiciones posteriores permitidas), por ejemplo:

- `succeeded`
- `dead_letter`
- `failed` (solo algunas outboxes; por ejemplo, hardware)

## Cuándo usarlo

Construye una outbox concreta **solo cuando** el efecto secundario:

1. No puede bloquear la transacción principal (emisión fiscal, cargo de pago o entrega de webhook: todos pueden tardar segundos, minutos u horas en confirmarse).
2. Tiene semántica de reintento distinta de la siguiente venta (un 5xx de DIAN no debe detener el siguiente clic; el núcleo reprograma sin bloquear).
3. Contiene suficiente estado como para que una cola en memoria pierda corrección al reiniciar (fallo de Electron a mitad de un cargo, reinicio del sistema operativo o terminación del servidor de desarrollo).

NO construyas una outbox para:

- Efectos secundarios síncronos que DEBEN ocurrir dentro de la transacción principal (por ejemplo, movimientos de inventario que hacen fallar la venta si no hay existencias suficientes: pertenecen a `db.transaction`).
- Consultas de solo lectura.
- Cálculos de una sola ejecución sin semántica de reintento (usa una función normal de servicio).
- Casos que encajan mejor en infraestructura existente (por ejemplo, un registro de auditoría: ya lo cubre `audit_logs`).

## Definir una outbox concreta (ejemplo)

Una outbox concreta compone la siguiente estructura:

```ts
// packages/server/src/db/schema.ts
export const fiscalOutbox = sqliteTable(
  'fiscal_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: fiscalOutboxStatusEnum }).notNull().default('queued'),
    payload: text('payload', { mode: 'json' }),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error', { mode: 'json' }),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    // Per-outbox extras live alongside the shared shape:
    fiscalDocumentId: text('fiscal_document_id').notNull(),
    providerId: text('provider_id').notNull(),
  },
  table => [/* indices */]
);

// packages/server/src/services/fiscal/fiscal-worker.ts
import {
  BOUNDED_EXPONENTIAL_BACKOFF,
  createOutboxKernel,
  tickOutbox,
} from '../../lib/outbox/index.js';

export const fiscalOutboxKernel = createOutboxKernel<FiscalOutboxStatus, FiscalPayload>({
  table: fiscalOutbox,
  kind: 'fiscal',
  initialStatus: 'queued',
  processingStatus: 'submitting',
  succeededStatus: 'accepted',
  retryingStatus: 'retrying',
  deadLetterStatus: 'dead_letter',
  terminalStatuses: ['accepted', 'dead_letter', 'rejected'],
  retryPolicy: BOUNDED_EXPONENTIAL_BACKOFF,
});

// Worker daemon (runs every 30 seconds inside the embedded server):
export async function fiscalWorkerTick(db, tenantId) {
  return tickOutbox(db, tenantId, {
    kernel: fiscalOutboxKernel,
    workerId: `fiscal-worker-${process.pid}`,
    loggerLabel: 'fiscal-outbox',
    process: async ({ row }) => {
      try {
        const result = await emitToProvider(row.payload);
        return {
          ok: true,
          persist: tx => {
            persistProviderResult(tx, row, result);
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: normalizeProviderError(err),
        };
      }
    },
  });
}
```

El núcleo gestiona toma, reintento y cola de fallos definitivos; el worker concreto aporta procesamiento de red, persistencia síncrona y programación. La normalización de errores del proveedor no debe envolver la transacción posterior de persistencia.

## Políticas de reintento

El núcleo incluye `BOUNDED_EXPONENTIAL_BACKOFF` como valor predeterminado canónico, con etapas `1m → 5m → 15m → 1h → 6h → 24h` y un límite de seis intentos. El núcleo incrementa los intentos antes de comprobar ese límite: el sexto intento fallido va a la cola de fallos definitivos, por lo que el límite predeterminado impide programar la última etapa de 24 horas:

```ts
import { BOUNDED_EXPONENTIAL_BACKOFF } from '../../lib/outbox/index.js';
// maxAttempts: 6, exponential, sized for human-scale provider outages.
```

Cada outbox concreta puede incluir su propia política:

- **Hardware**: usa de forma predeterminada la misma política exponencial acotada, con una política inyectable para el worker concreto; los fallos que agotan los intentos van a la cola de fallos definitivos.
- **Webhook**: usa 30s → 2m → 10m → 1h → 6h, con un límite de seis intentos.
- **Pagos**: el worker actual realiza mantenimiento e importaciones de extractos inyectadas, no envía cargos mediante este núcleo. Una política de reintentos para cargos en vivo no es una capacidad implementada.

## Invariante de múltiples tenants

Cada método del núcleo recibe `tenantId` explícitamente. Las pruebas de concurrencia verifican que dos llamadas paralelas a `claimNext` con alcance de distintos tenants nunca tomen la misma fila, incluso si ambas filas comparten prioridad y createdAt. La función auxiliar `peek` también tiene alcance de tenant: no permite inspección entre tenants en la capa del núcleo.

## Concurrencia: contrato de status + claim_token

Dos workers consultando la misma outbox al mismo tiempo es el caso esperado (un worker en primer plano impulsado por el renderer y uno en segundo plano impulsado por setInterval). La toma atómica del núcleo funciona así:

1. SELECT de la siguiente fila elegible (por prioridad, createdAt y programación de reintentos) cuyo `claim_token` sea nulo y cuyo estado sea `initialStatus` o `retryingStatus` ya vencido.
2. UPDATE de esa fila a `processingStatus`, estableciendo `claim_token` y `locked_at`, protegido por `id = ? AND tenant_id = ? AND status = <candidate status> AND claim_token IS NULL`. Si el UPDATE devuelve `changes = 0`, otro worker ganó o la fila se completó antes de nuestra toma: el worker devuelve `null` y vuelve a intentarlo en el siguiente ciclo.

`claim_token` es el bloqueo técnico. `status` es el ciclo de vida visible para el operador que las pantallas fiscales, de pagos, de hardware y el Centro de operaciones pueden explicar al equipo de soporte.

### Liquidación protegida por propiedad y progreso intermedio

`complete`, `fail` y `deadLetter` requieren `{ id, tenantId, claimToken }` y solo modifican la fila de procesamiento coincidente. La finalización y el envío a fallos definitivos devuelven un booleano; el fallo devuelve un discriminante `applied`. Un resultado falso indica pérdida de propiedad, no un fallo del proveedor, y no consume un reintento ni revive una fila terminal. Estos métodos de confirmación son síncronos.

`tickOutbox` ejecuta la confirmación, el callback opcional `persist(tx)` del procesador y el callback opcional `onSettled(tx, outcome)` dentro de una sola transacción `BEGIN IMMEDIATE`. Si la persistencia lanza una excepción, los tres se revierten; la excepción sigue siendo un fallo local de persistencia en vez de convertirse en un rechazo fiscal del proveedor. Los callbacks devuelven `undefined`, no una Promise, y deben usar el `tx` recibido. El trabajo de red queda fuera de la transacción de escritura.

Para los efectos necesarios antes de la liquidación final, `mutateIfOwned(tx => ...)` comprueba la propiedad y ejecuta la modificación síncrona bajo el mismo control de escritura inmediato. Los webhooks conservan el éxito por destino antes de enviar al siguiente suscriptor; los reintentos no vuelven a enviar a destinos que ya recibieron la entrega. Los workers de webhooks y alertas operativas vuelven a comprobar la propiedad después de DNS y antes del transporte. La creación de intentos de alertas operativas y la evidencia final están protegidas por propiedad para que una respuesta tardía no sobrescriba un intento que la recuperación ya marcó como interrumpido.

El estado del documento fiscal y el CUFE se confirman junto con la confirmación del propietario. El evento opcional de webhook de aceptación y los metadatos de salud conservan su comportamiento existente de mejor esfuerzo mediante puntos de guardado anidados síncronos: su fallo no debe deshacer la aceptación fiscal ni causar un segundo envío al proveedor. La entrega opcional de eventos no sustituye la obligación fiscal duradera.

Esto protege los resultados persistidos localmente, no la entrega externa exactamente una vez. Un fallo después de un efecto remoto pero antes de la confirmación local aún puede causar otro intento. Conserva claves de idempotencia estables, entradas fiscales congeladas y numeración. La invalidación de cocina conserva su ruta separada de entrega síncrona protegida por propiedad.

## Tabla de metadatos de outbox

`outbox_metadata` es la superficie de salud entre outboxes. Cada outbox concreta actualiza su fila periódicamente con `pendingCount`, `oldestPendingAt`, `lastSuccessAt` y `lastFailureAt`. Esta es una instantánea compartida de salud, no un contrato exclusivo de lectura para el Centro de operaciones. Operaciones también lee tablas concretas del dominio para obtener cantidades que requieren atención y el estado de pagos.

El núcleo expone las funciones auxiliares `recordSuccess`, `recordFailure` y `refreshPendingCount`. Las escrituras de éxito o fallo son síncronas y pertenecen a la transacción `onSettled` del propietario; la actualización periódica del conteo de pendientes es separada. NO se llaman automáticamente: las outboxes concretas optan por integrarlas. Esto mantiene el núcleo desacoplado de la tabla de metadatos; cada worker concreto es responsable de su integración.

## Relación con otros patrones

- **[Diario de operaciones](../../../architecture/patterns/operation-journal.md)**: las filas de outbox contienen `operationId` en su carga; los workers que escriben `operation_effects` (éxito) u `operation_errors` (fallo) contra el evento de origen completan la trazabilidad de extremo a extremo.
- **Sobre de comando (ADR-0002)**: las mutaciones críticas encolan filas duraderas de outbox del dominio DENTRO de la transacción principal mediante servicios. La entrega al proveedor y la activación del worker ocurren después de confirmar.
- **Autoridad del almacenamiento local (ADR-0001)**: las filas de outbox viven en SQLite local. Los workers las procesan localmente. Cualquier sincronización hacia el servidor sigue el contrato separado de admisión de sincronización; el propio núcleo nunca accede a la red.
