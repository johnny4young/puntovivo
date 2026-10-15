# 0015: conteos minoristas y reposición

**Idioma:** Español · [English](../../architecture/0015-retail-counts-and-replenishment.md)

> Estado: aceptada
> Fecha: 31 de agosto de 2026

## Contexto

Un ajuste registra delta, pero no prueba conteo de productos definidos sin ver
el libro, envío completo a revisión ni conciliación con instantánea inicial.
Reutilizarlo perdería flujo y dejaría que ventas/recepciones concurrentes cambien
silenciosamente el significado de discrepancia.

Mínimo es umbral, no orden automática: no elige proveedor, gasto ni stock entrante
sin decisión humana. Ignorar órdenes abiertas duplicaría sugerencias ya planeadas.

## Decisión

### Agregado de conteo físico

- `inventory_count_sessions` conserva ciclo/actor por sede;
  `inventory_count_lines` congela producto, unidad base, saldo firmado exacto,
  revisión monotónica y costo inicial. Saldo firmado permite corregir negativos
  históricos; observación física sigue no negativa.
- Leer oculta esperado, diferencia y costo. Enviar exige cantidad contada no
  negativa en todas las líneas y congela diferencias para revisión.
- Sesión/líneas usan versiones CAS. `BEGIN IMMEDIATE` serializa crear para no
  contar dos veces simultáneamente un mismo producto/sede sin terminar.
- Todo escritor avanza `inventory_balances.version`, separado de `sync_version`
  de transporte. Aprobar relee saldo/revisión bajo reserva. Diferencia contra
  apertura, o producto/unidad base inactivo/incompatible, bloquea. Vender y
  devolver invalida aun con saldo neto igual; nunca rebasa observación sobre libro nuevo.
- Aprobar escribe un registro físico `initial_inventory` por línea. Solo
  diferencia no nula cambia `inventory_balances` y escribe ajuste. Estado,
  evidencia, auditoría, sync manual, resultado e idempotencia confirman juntos.
  Rechazar conserva evidencia sin stock.
- Admite ordinarios e hijos de variante vendibles; excluye servicios, padres,
  lotes y series porque una cantidad no reconstruye identidades.

### Proyección y borrador de reposición

- Por sede calcula `max(on_hand - reserved, 0)` y agrega base pendiente de
  órdenes borrador, enviadas y parcialmente recibidas, restando recepción
  completada vinculada una sola vez.
- Solo producto activo con stock y mínimo positivo. Cierra brecha al mínimo;
  no pronostica ni implementa punto de reorden, stock de seguridad o proveedor recomendado.
- Operador elige proveedor y líneas admisibles. Aceptar crea orden ordinaria
  `draft`: asigna número estable para auditoría/replay, sin stock, deuda ni pago;
  no puede recibirse.
- Gerente/admin envía explícitamente antes de recepción. Ambos descartan borrador;
  solo admin anula enviada. Permiso/estado se revalidan bajo escritor para que
  enviar concurrentemente no amplíe autoridad del gerente.
- Lotes/series pueden planear cantidades sin identidades aún inexistentes;
  recepción exige asignación exacta completa antes de tocar stock. Padres y servicios se excluyen.

## Consecuencias

- Control diario tiene estados auditables, no ajuste sin revisar.
- Seguir vendiendo puede obligar a reiniciar conteo; se prefiere corrección a
  incorporar movimiento posterior silenciosamente.
- Un gerente puede contar y aprobar en tienda pequeña; registra actores
  diferentes cuando los hay, sin imponer segregación de funciones.
- Borradores activos suprimen sugerencia duplicada; descartar la devuelve si sigue faltante.
- No hay conteos físicos por lote/serie, compras automáticas, pronóstico,
  optimización de proveedor ni aceptación externa.
- [ADR-0018](../../architecture/0018-lot-procurement-and-transformations.md) controla procedencia
  de recepción/devolución/transferencia/transformación, sin cambiar exclusión del conteo agregado.

## Alternativas rechazadas

- **Ajuste directo:** pierde hoja ciega, envío, revisor y protección de instantánea.
- **Recalcular al aprobar:** altera observación y oculta venta/recepción concurrente.
- **Contar identidades agregadas:** inventa qué lotes/series existen y rompe FEFO,
  garantía, retiro o procedencia.
- **Orden enviada por cada faltante:** convierte consejo en compra sin revisión.
- **Ignorar órdenes borrador/abiertas:** duplica necesidad y exagera compra.
- **Gerente anula cualquier orden:** elimina evidencia comprometida; solo borradores tienen permiso ampliado.

## Verificación

- `packages/server/src/__tests__/inventory-counts.test.ts`
- `packages/server/src/__tests__/orders.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `packages/server/src/__tests__/perf-store-profile.test.ts`
- `apps/web/src/features/inventory/InventoryControlPanel.test.tsx`
- `apps/web/src/features/orders/OrderDetailsModal.test.tsx`
- `e2e/web/business.spec.ts`
- `operator-journeys.json`
- `pnpm run ci:server`
- `pnpm run ci:web`
- `pnpm run test:e2e:web`
