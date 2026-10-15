# 0005: contrato de payload de sincronización

**Idioma:** Español · [English](../../architecture/0005-sync-payload-contract.md)

> Estado: **aceptada**; v1 del 5 de mayo de 2026, extensión de transporte v3 del 2 de septiembre y límite de recuperación v4 del 6 de septiembre.
> Afecta: routers que emiten cambios replicables, lecturas del Centro de operaciones, aceptación de caos y negociación entre tiendas.
> Predecesoras: 0002, sobre; 0003, bandejas; 0004, conflictos.

## Decisión

Cada fila de la bandeja tiene un contrato exhaustivo del manifiesto de entidades.
Toda fila de `sync_outbox` lleva:

- `payload_version`, entero predeterminado 1: controla divergencia de esquema.
- `idempotency_key`, texto nullable: liga al sobre emisor ADR-0002. Reintentos
  colapsan por índice parcial `(tenant_id, entity_type, entity_id, operation, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- `device_id`, FK nullable a `devices.id`: procedencia diagnóstica entre equipos.
- `depends_on_operation_id`, referencia lógica nullable a `operation_events.operation_id`:
  orden topológico para aplicar padres antes que hijos.
- `operation_event_id`, FK nullable a `operation_events.id`: correlación del diario.
- `priority`, real predeterminado 0: salida por `(priority DESC, created_at ASC)`.
- `conflict_policy`, `manual | auto_lww`: ADR-0004; `manual` para ventas/caja/
  fiscalidad/inventario/auditoría y `auto_lww` para catálogo/preferencias.
  v1 expone el indicador; la rama real de resolución automática sigue diferida.
- `status = local_only`: traza terminal de soporte para entidades sin transporte
  seguro. No entra en pendientes ni preparación; solo la retención del negocio la elimina tras su corte.

`packages/server/src/services/sync/contract.ts` es la fuente única. Una entidad
nueva de un escritor DEBE entrar en `SYNC_ENTITY_TYPES` + `SYNC_CONFLICT_POLICY`.
La exhaustividad `Record<SyncEntityType, ...>` y una prueba Vitest que escanea
literales `entityType: '...'` en routers detectan divergencias al compilar.

Los consumidores consultan `sync.getContract()` con rol manager/admin; devuelve
`{ payloadVersion, entities: Array<{ entityType, conflictPolicy, transportPolicy, defaultPriority, operatorPayloadPolicy }> }`.
`transportPolicy` es `outbound | local_only`; nunca convierte `local_only` en
trabajo remoto. Es política del origen, no handshake remoto ni codec entrante
implementado. Los lectores conservan versión histórica sin reconstruir instantáneas
financieras faltantes. v3 hizo explícito el transporte del agregado farmacéutico
regulado, manteniendo sus filas terminales en origen.

v4 anuncia instantáneas exactas de valor de inventario y `operatorPayloadPolicy`
independiente: `blocked`, `product_metadata_only` o `existing`. `existing` mantiene
controles anteriores, no permite aplicación remota libre. Las entidades con
inventario no se reconstruyen ni descartan mediante JSON de cola/conflicto
escrito por operador. Recuperar producto solo permite actualizar metadatos de
lista permitida de uno existente del negocio; rechaza cantidad, costo, cursores
de valoración, modos de seguimiento y campos desconocidos. Las transacciones de
dominio siguen escribiendo intención original completa y conservan reintento.

Las lecturas exponen `resolutionAvailability` por elección. Las mutaciones
revalidan vínculos negocio/entidad y todos los payloads originales bajo escritor
inmediato antes de reemplazar. Decisión pendiente, borrado y encolado de reemplazo
confirman juntos o revierten todo. También se rechaza borrar por separado una
fila protegida. Una opción no disponible conserva el incidente para recuperación
de dominio; no es restricción solo visual. `sync.push` confirma intención local,
no entrega ni aplicación atómica en otra base.

## Alternativas rechazadas

- **Payload libre con política decidida al consumir:** saca la decisión del
  negocio autoritativo y permite desacuerdo sobre `customers`, `manual` y
  `auto_lww`. El manifiesto decide al emitir y la política viaja con la fila.
- **Tablas `sync_outbox_manual` + `sync_outbox_auto_lww`:** duplica conexiones sin
  beneficio: mismo núcleo, reintentos y metadatos; basta una columna enum.
- **Unir el contrato inicial y todo el cambio de escritores heredados:** v1
  separó la base contractual de migrar `sync_queue` a `sync_outbox`. El cambio
  ya se entregó mediante `0017_drop_sync_queue.sql`; no está pendiente.

## Impacto de implementación

- **Migración `0016_sync_contract_v1.sql`:** crea `sync_outbox` como
  `fiscal_outbox` / `hardware_outbox`: proyección del núcleo, seis columnas de
  contrato y cuatro índices incluido idempotency_key parcial. `INSERT OR IGNORE`
  copia pendientes `sync_queue` con valores compatibles. **`0017_drop_sync_queue.sql`
  del 5 de mayo de 2026** elimina la tabla heredada tras mover escritores a
  `enqueueSync` y ocho procedimientos `sync.*` a `sync_outbox`.
- **`services/sync/contract.ts`:** manifiesto, `resolveConflictPolicy(entityType)`,
  `resolveSyncTransportPolicy(entityType)`, `resolveDefaultPriority(entityType)`
  y `buildSyncContractManifest()`.
- **`services/sync/enqueue.ts`:** `enqueueSync(ctx, args)` sustituye
  `db.insert(syncQueue)`. Lee `ctx.envelope?.{operationId, idempotencyKey}` y
  `ctx.deviceId`, resuelve `operation_event_id` en el índice operation_events,
  completa contrato y escribe fila y traza `operation_effects`.
- **tRPC:** `sync.getContract` / `sync.peekOutbox` / `sync.retry` operan en
  `sync_outbox`. `sync.retry` solo reactiva `retrying` / `dead_letter`;
  `queued` / `submitting` / `synced` / `conflict` no cambian para no reproducir
  una fila vaciada. Compara estado `status` / `attempts` / `updatedAt` observado;
  un push que cambia o elimina entre lectura y escritura produce `CONFLICT` /
  `STALE_VERSION`, sin sobrescribir el intento posterior. Otro reintento que
  ya la encoló es éxito sin cambios. Los existentes
  `status / listQueue / addToQueue / removeFromQueue / listConflicts / push / pull / resolve`
  también usan `sync_outbox`. Escrituras del operador validan política antes
  del helper; escritores de dominio confiables no pasan por esa superficie.
  `sync.listQueue` + `sync.pull` conservan `payload→data` y
  `payloadVersion→localVersion` por compatibilidad.
- **Pruebas de aceptación** en `packages/server/src/__tests__/sync-contract-v1.test.ts`:
  orden, reintento, deduplicación y conflicto manual de alto riesgo. Las de
  `sync-contract-manifest.test.ts` fijan entidad/política contra el escaneo de escritores.

## Mapa de implementación

- Este ADR: base v1, tres procedimientos y aceptación, entregado el 5 de mayo de 2026.
- Cambio entregado ese día: 19 escritores de routers de `db.insert(syncQueue)`
  a `enqueueSync`, cuatro servicios de aplicación y un seed dev; ocho
  procedimientos `sync.*` de `sync_queue` a `sync_outbox`; retirada mediante
  `0017_drop_sync_queue.sql`; archivo cliente `services/storage/syncQueue.ts`
  renombrado a `offlineQueue.ts`. El ObjectStore IndexedDB conserva `SYNC_QUEUE`
  para no cambiar versión de base del cliente.
- Centro de operaciones usa `sync.getContract` y `sync.peekOutbox` para distinguir conflictos manuales.
- Caos prueba orden/reintento/deduplicación bajo fallos de red simulados.
- Replicar entre tiendas aún requiere codec entrante de agregado y transporte
  implementados/validados. El manifiesto por sí solo no establece esas capacidades.
