# 0004: política de conflictos

**Idioma:** Español · [English](../../architecture/0004-conflict-policy.md)

> Estado: aceptada
> Fecha: 2 de mayo de 2026

## Decisión

**Los conflictos de alto riesgo, dinero, fiscalidad, caja, inventario y auditoría,
nunca se resuelven automáticamente. Recuperación del operador no es excepción:
una elección conserva el agregado completo o permanece bloqueada.**

El manifiesto cerrado clasifica `manual` y `auto_lww`, pero este último es un
indicador, no un motor automático implementado. Productos contiene stock y
bases financieras además de descripción; no es un catálogo totalmente no financiero.

`sync.listConflicts` y `sync.pull` exponen `localRecordExists` y
`resolutionAvailability` calculada por servidor para local, remoto y combinado.
La interfaz desactiva acciones no disponibles y explica conservación de evidencia.
La mutación revalida ámbito/payload bajo escritor inmediato. Una fila local
faltante no vuelve segura la remota. Los agregados con inventario y campos
financieros/de seguimiento no se reconstruyen, reemplazan ni eliminan mediante JSON de cola.

Un producto existente del negocio admite recuperación de metadatos permitidos,
sin cambiar stock, valor ni custodia. Todos sus payloads originales deben ser
seguros antes de reemplazar/borrar; un conflicto descriptivo no oculta un comando
protegido. Conflicto y nueva intención confirman juntos. Comandos de dominio y
reintento original son distintos de editar payloads manualmente. Consulta
[ADR-0005](../../architecture/0005-sync-payload-contract.md), contrato v4 y límite de confirmación local.

---

## Entidades de alto riesgo

Estas familias principales nunca aceptan resolución automática. Conflictos
permanecen `pending` y requieren revisión humana; la clasificación completa está
en `SYNC_CONFLICT_POLICY`, no se infiere de esta lista ilustrativa.

**Ventas y devoluciones**

- `sales`
- `sale_payments`
- `sale_returns`
- `sale_items` (instantánea inmutable; exige investigar corrupción, no sobrescribir)

**Caja**

- `cash_sessions`
- `cash_movements`

**Fiscal**

- `fiscal_documents`
- `fiscal_document_items`
- `fiscal_numbering_resolutions`
- `fiscal_certificates`
- `fiscal_outbox`

**Inventario operativo**

- `inventory_movements`
- `inventory_balances`
- `transfer_orders`
- `transfer_order_items`
- `stock_adjustments`

**Auditoría**

- `audit_logs` (instantánea inmutable; nunca se sobrescribe)

Son evidencia contable/fiscal. Elegir automáticamente puede duplicar cobro,
borrar una nota de crédito fiscal, desbalancear caja cerrada, perder procedencia
entre sedes o romper auditoría. Preservar significado requiere intervención
humana; el orden temporal por sí solo no basta.

---

## Entidades no financieras candidatas a último escritor

Son candidatas a un motor futuro, no afirmación de que exista actualmente.
Ese motor debe auditar instantáneas y respetar campos financieros/agregados
antes de usar fechas:

**Catálogo**

- `customers`
- `products`
- `categories`
- `units`
- `providers`
- `vat_rates`
- `identification_types`
- `client_types`
- `commercial_activities`
- `regime_types`
- `person_types`

**Preferencias y plantillas**

- `receipt_templates`
- `tenant_locale_settings`
- `app_settings`
- `tenants.settings` (JSON; subclaves como `fiscal.mx.*` siguen regla del padre)

**Sedes y ubicaciones**

- `sites`
- `locations`
- `site_peripherals`

**Metadatos de sincronización**

- Filas `sync_outbox` en estado `synced`.
- `idempotency_keys` tras `expires_at`.

**Límite:** el nombre de entidad no prueba seguridad. Costos, impuestos, modos
de seguimiento y geografía que afectan agregados requieren validación de dominio;
ser administrador no permite reemplazar campos arbitrarios. La lista actual
es deliberadamente más estrecha que una fila completa.

La auditoría requerida para cualquier motor automático futuro es:

```
{
  action: 'sync.auto_resolved',
  resourceType: '<table name>',
  resourceId: '<row id>',
  metadata: {
    winner: 'local' | 'remote',
    loserSnapshot: <full row JSON>,
    detectedAt: ISO timestamp,
    resolvedAt: ISO timestamp
  }
}
```

La instantánea propuesta del perdedor permite investigar; no implementa deshacer
ni concede permiso para mutar evidencia confirmada.

## Alternativas rechazadas

- **Último escritor universal:** corrompe contabilidad y procedencia fiscal;
  un orden accidental puede reemplazar documento original con cancelación.
- **CRDT para todo:** insuficiente para integridad; dinero/impuestos no se
  combinan sumando y los importes en conflicto exigen criterio humano.
- **Todo manual:** agrega trabajo innecesario ante cambios menores seguros de metadatos de catálogo.
- **Fechas con relojes vectoriales:** añade complejidad sin resolver integridad;
  aun con orden perfecto, `sale_payments` requiere identificar la transacción real.

## Impacto de implementación

- `services/sync/contract.ts` controla clasificación, transporte y política
  independiente de payload del operador; una prueba fija el mapeo.
- `services/sync/operator-policy.ts` comparte controles de negocio/entidad/payload
  entre capacidades de lectura y mutaciones autoritativas.
- `trpc/routers/sync/conflicts.ts` resuelve pendiente y reemplaza intención
  segura en transacción inmediata; rechaza decisiones antiguas.
- `trpc/routers/sync/queue.ts` protege altas/bajas manuales; escritores del sistema usan el helper transaccional.
- La interfaz de Empresa presenta incidentes y elecciones disponibles; no
  promete fecha de resolución automática ni aplicación remota.
- Respaldo/restauración conservan colas y conflictos con negocio; restaurar no
  inventa un veredicto de conciliación remota.

Actualizado: 6 de septiembre de 2026, límite de recuperación y estado real de implementación.
