# Patrón: Diario de operaciones

**Idioma:** Español · [English](../../../architecture/patterns/operation-journal.md)

> Estado: Activo
> ADR relacionados: [ADR-0001](../0001-local-store-authority.md), [ADR-0002](../0002-command-envelope.md), [ADR-0003](../0003-outbox-taxonomy.md)
> Código: `packages/server/src/services/operation-journal/journal.ts`

El **diario de operaciones** correlaciona el ciclo de vida de cada comando crítico: el clic que lo inició, los efectos secundarios que produjo y cualquier fallo posterior a la confirmación que sobrevivió a la transacción principal. Las filas de efectos y errores se agregan; la fila del evento contiene un resumen actualizable y un estado de ciclo de vida.

## Qué es

Tres tablas respaldadas por `operation_id` (el UUID generado por el renderizador para cada sobre, ADR-0002):

| Tabla               | Cardinalidad          | Propósito                                                                                          |
| ------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `operation_events`  | una por clic crítico  | "El clic X comenzó en T1 y pasó al estado S en T2"                                                 |
| `operation_effects` | varias por evento     | "Esta operación escribió la fila de auditoría Y, emitió la fila de cola de sincronización Z, etc." |
| `operation_errors`  | cero o más por evento | "Después de confirmar, el envío fiscal falló con el código F (recuperable)"                        |

En un primer intento con escrituras completas del diario, una venta exitosa produce:

```
operation_events:  status = succeeded
operation_effects: kind = sale_row, kind = audit_log, kind = inventory_movement, ...
operation_errors:  (empty)
```

Una venta confirmada cuyo trabajo posterior de distribución falla puede producir lo siguiente cuando el evento aún está iniciado. Una vez terminal, su estado no puede cambiar a otro estado terminal; un error posterior del trabajador no convierte por sí mismo un evento ya exitoso en una finalización parcial:

```
operation_events:  status = partial
operation_effects: kind = sale_row, kind = audit_log, ...   (the parts that committed)
operation_errors:  errorCode = FISCAL_TRANSIENT, recoverable = true
```

Una venta rechazada por el procedimiento (revertida) produce lo siguiente en su primer intento. Un reintento con el mismo sobre después de un fallo totalmente revertido puede reabrir el evento cuando siguen coincidiendo el tipo de comando, dispositivo, actor y hash de solicitud; las filas anteriores de errores permanecen como evidencia de intentos aunque un reintento posterior tenga éxito:

```
operation_events:  status = failed
operation_effects: (empty — nothing committed)
operation_errors:  errorCode = INVENTORY_INSUFFICIENT, recoverable = false
```

## Por qué

Sin el diario, depurar "¿por qué este clic no produjo X?" requiere buscar en registros, relacionar marcas de tiempo entre más de 5 tablas y adivinar qué fila de auditoría corresponde a cada intención del usuario. Con el diario, **una llamada a un helper**, `getOperationTrail`, carga el evento limitado al tenant y sus efectos y errores ordenados. Una consulta directa `SELECT * FROM operation_events WHERE operation_id = ?` lee solo el encabezado del evento y omite el predicado de tenant; no es una consulta de aplicación completa ni segura para obtener el rastro.

El patrón también apoya al [núcleo de outbox](outbox-kernel.md): los trabajadores pueden correlacionar una fila fallida mediante su `operation_id` y agregar una entrada de `operation_errors` al evento original del diario. Cada integración debe emitir esa evidencia explícitamente; una fila de outbox por sí sola no llena el rastro. El Centro de operaciones expone superficies de outbox y atención; el router actual de operaciones no expone un procedimiento dedicado al detalle completo del diario.

## Cuándo usarlo

Solo los **comandos críticos** (la lista cerrada en ADR-0002) emiten eventos del diario. El middleware que los envuelve (`commandEnvelope`) registra automáticamente la fila de inicio; los servicios NO llaman directamente a `recordOperationStart`.

Los servicios (o trabajadores) SÍ llaman explícitamente a los efectos y errores:

- Después de confirmar una venta: `recordEffect({operationEventId, kind:
'sale_row', resourceType: 'sales', resourceId: saleId})`.
- Después de que falla un trabajo de distribución posterior a la confirmación: `recordError({operationEventId, errorCode, recoverable: true})` seguido de `markOperationCompleted(eventId, 'partial')` solo mientras el evento sigue iniciado. Los errores registrados después de la finalización terminal permanecen como evidencia separada sin cambiar ese estado terminal.

**No** emitas entradas del diario para:

- Consultas de solo lectura (sin sobre ni fila de evento).
- Mutaciones habituales de catálogo fuera de la lista actual de comandos críticos (productos, clientes, unidades, tasas de IVA). La unicidad por fila no reemplaza de forma general un sobre de comando: por ejemplo, `restaurantModifiers.save` es un comando de catálogo explícitamente envuelto.
- Cambios de preferencias (`fiscalSettings.update`, `ai.settings.update`).

## Ciclo de vida

```
                     ┌──────────────────┐
                     │  commandEnvelope  │
                     └────────┬─────────┘
                              │
                              ▼
                  recordOperationStart()
                              │
                              ▼
                  ┌────────────────────────┐
                  │  procedure runs inside  │
                  │  a DB transaction       │
                  └────────────┬───────────┘
                              │
            ┌─────── success ─┴─ failure ────────┐
            ▼                                     ▼
   recordEffect(...)                       recordError(...)
   markCompleted('succeeded')              markCompleted('failed')


      ┌─── post-commit fan-out (workers, +) ────┐
      ▼                                                ▼
   ok: recordEffect(kind='fiscal_emit', ...)    fail: recordError(...)
                                                       markCompleted('partial')
```

## Superficie de API

```ts
// services/operation-journal/journal.ts

recordOperationStart(db, {
  tenantId, operationId, operationKind, deviceId, userId, requestHash, summary?
}): Promise<{ eventId, isNew }>

recordEffect(db, {
  operationEventId, kind, resourceType, resourceId, effectData?
}): Promise<{ effectId }>

recordError(db, {
  operationEventId, errorCode, message, recoverable, errorData?
}): Promise<{ errorId }>

markOperationCompleted(db, eventId, status): Promise<void>
  // status: 'succeeded' | 'failed' | 'partial'
  // Idempotent: refuses to transition out of a terminal state.

getOperationTrail(db, { tenantId, operationId }):
  Promise<{ event, effects, errors } | null>
```

## Invariante multitenant

Cada helper recibe `tenantId` explícitamente (`recordOperationStart`, `getOperationTrail`) o queda vinculado por clave foránea a una fila que ya tiene alcance de tenant (`recordEffect`, `recordError` referencian una fila de evento que tiene `tenantId`). La consulta limitada al tenant evita lecturas entre tenants cuando quienes llaman usan ese límite. Los escritores internos de efectos/errores confían en el identificador de evento suministrado; su clave foránea no autoriza de forma independiente a quien llama ni acepta de forma segura un identificador arbitrario de otro tenant. La restricción UNIQUE compuesta sobre `(tenantId, operationId)` garantiza que el tenant A y el tenant B puedan usar el mismo valor de `operationId` sin colisiones: el núcleo los separa por fila.

## Semántica de mejor esfuerzo POST-procedimiento

`recordEffect` y `recordError` NUNCA DEBEN provocar la reversión del trabajo principal. El middleware envuelve estas llamadas en `try/catch` con registros de nivel de advertencia, y los procedimientos deben seguir el mismo patrón cuando emiten efectos directamente. El diario sirve para observabilidad, no como control de corrección.

Si falla la propia escritura del diario (bloqueo de base de datos, disco lleno), el trabajo principal permanece confirmado. La falta de evidencia en el diario es una brecha de observabilidad, no una prueba de que falló la transacción principal. Consulta los registros de nivel de advertencia y el estado autoritativo del dominio; el Centro de operaciones actual no ofrece una vista dedicada a brechas del diario.

## Ejemplo de código

El siguiente ejemplo es pseudocódigo esquemático que muestra el límite posterior a la confirmación, no un servicio ejecutable ni un requisito de implementación futura. El caso de uso actual `completeSale` ya emite efectos de mejor esfuerzo mediante `packages/server/src/application/sales/journal-effects.ts`. El extracto de API y el esquema del ciclo de vida muestran la finalización terminal; la regla de reapertura de un intento fallido coincidente se implementa por separado en `recordOperationStart`.

```ts
// In a future application service ( will do this for
// `completeSale`):
import { getOperationTrail, recordEffect } from '../../services/operation-journal/journal.js';

async function completeSale(ctx: Context, input: CompleteSaleInput) {
  const { sale, audit } = await ctx.db.transaction(async tx => {
    const sale = await insertSaleRow(tx, input);
    const audit = await writeSaleCreateAuditLog(tx, sale);
    // Inside the transaction we DO NOT emit journal effects —
    // any failure here rolls back the primary work, including the
    // effect, which would leave a dangling reference.
    return { sale, audit };
  });

  // Outside the transaction: best-effort journal effects.
  try {
    const trail = await getOperationTrail(ctx.db, {
      tenantId: ctx.tenantId,
      operationId: ctx.envelope.operationId,
    });
    if (!trail) {
      ctx.log.warn('journal event missing; sale committed without effect trail');
      return sale;
    }
    await recordEffect(ctx.db, {
      operationEventId: trail.event.id,
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: sale.id,
      effectData: { total: sale.total, paymentMethod: sale.paymentMethod },
    });
    await recordEffect(ctx.db, {
      operationEventId: trail.event.id,
      kind: 'audit_log',
      resourceType: 'audit_logs',
      resourceId: audit.id,
    });
  } catch (err) {
    ctx.log.warn({ err }, 'journal effect emission failed; sale committed');
  }
}
```

## Relación con otros patrones

- **Command Envelope (ADR-0002)**: las escrituras del diario se identifican mediante el `operationId` del sobre. Sin sobre no hay evento del diario, y eso es deliberado: solo los comandos críticos necesitan este rastro.
- **[Núcleo de outbox](outbox-kernel.md)**: la outbox almacena efectos secundarios reintentables; el diario almacena el registro histórico de QUÉ se intentó y QUÉ ocurrió. Los trabajadores que procesan filas de outbox pueden agregar explícitamente `operation_effects` (éxito) u `operation_errors` (fallo) al evento de origen.
- **Autoridad del almacén local (ADR-0001)**: el diario pertenece a la autoridad local. La correlación con una outbox de sincronización no demuestra que los eventos completos del diario se publiquen remotamente. Cualquier publicación futura necesita un contrato de transporte explícito y debe conservar la autoridad local.
