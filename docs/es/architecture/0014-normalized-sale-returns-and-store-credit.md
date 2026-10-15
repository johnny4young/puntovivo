# 0014: devoluciones normalizadas y crédito de tienda

**Idioma:** Español · [English](../../architecture/0014-normalized-sale-returns-and-store-credit.md)

> Estado: aceptada
> Fecha: 31 de agosto de 2026
>
> [ADR-0016](0016-server-authoritative-promotions-and-customer-value.md) completó después uso al cobrar y restauración exacta ligada al origen.

## Contexto

La devolución antigua cambiaba venta a `refunded` y revertía todo el ticket.
No representaba cantidad de una línea, devoluciones sucesivas, impuestos exactos,
lotes/series, cambio de producto ni destino de cada medio. Reconstruir desde
catálogo mutable o un importe de cabecera inventaría evidencia financiera/física.

Crédito de tienda necesita libro inmutable y saldo sin actualizaciones perdidas
para emitir, usar, revertir y operar cajas concurrentes. Un cambio de producto
no evita reglas ordinarias de venta.

## Decisión

### Agregado inmutable de devolución

- La venta completada sigue inmutable. Cada devolución parcial/completa es un
  agregado `sale_returns` con hijos normalizados de líneas, impuestos, lotes,
  series y asignación de pagos originales.
- El planificador lee instantáneas y devoluciones previas dentro del escritor,
  expone remanentes y calcula subtotal, descuento, impuesto, total y costo
  proporcional mediante `roundMoney`. La última asignación recibe los centavos exactos restantes.
- Precio, impuesto, nombre, SKU, seguimiento y cliente actuales no cambian el
  cálculo histórico. Divergencia de seguimiento bloquea porque ya no puede
  interpretarse la procedencia física segura.
- Devoluciones completas antiguas conservan vista compatible. Migrar crea hijos
  solo desde contrato histórico completo y evidencia congelada. Si no se
  prueba línea, pago, lote o serie, cabecera conserva fallback acotado sin inventar.

### Dinero y valor del cliente

- Destinos suman exactamente total. El plan parte del importe restante por
  medio original; solo redirige porciones pagadas a destinos admitidos.
- Efectivo exige caja abierta actual en sede original y movimiento firmado en
  la misma transacción. Venta a crédito reduce cuenta del cliente original,
  no crea efectivo. Tarjeta/externo exige referencia no vacía del operador:
  registra evidencia, no ejecución del proveedor.
- Emitir crédito requiere cliente en la venta. Cuenta por negocio/cliente/moneda
  avanza con CAS y movimiento inmutable ligado a devolución. Esta decisión
  estableció emisión; ADR-0016 amplía uso al cobrar y restauración de origen.
- Puntos acumulados se revierten proporcionalmente una sola vez. ADR-0016
  define uso y bloqueo por puntos ya gastados, sin esconder semántica en migración.

### Inventario y cambio de producto

- Stock vuelve solo a sede original. Lote/cantidad/serie debe seguir retornable
  desde la venta y solo puede consumirse una vez por historia de devolución.
- Reponer no restaura vendibilidad: vencidos, cuarentena y estados futuros
  inseguros siguen bloqueados. Solo lote `depleted` todavía válido vuelve a `active`.
- Un cambio liga de forma única una devolución normalizada con otra venta
  completada independiente. La nueva pasa reglas habituales de caja, stock,
  impuestos, precio, aprobación e idempotencia. Conserva cliente si lo tenía el origen.

### Transacción, reproducción y replicación

- Filas, inventario/valor del cliente, caja, auditoría, sync, referencia canónica
  e idempotencia comparten `BEGIN IMMEDIATE`.
- `sales.create` y `sales.completeDraft` confirman venta y bandejas de lotes
  antes de referencia diferida e idempotencia. Fallar intención de replicación
  revierte negocio; fallar después permite reproducir respuesta exacta sin duplicar.
- Sync v2 transporta cabecera e hijos inmutables como agregado canónico. Cuentas,
  movimientos, lotes, series, saldos y vínculos mantienen entidades deterministas
  propias. Es intención local persistente, no aplicación causal completa ni convergencia multidispositivo.
- Nota de crédito fiscal, broadcast y resumen del diario ocurren después de
  confirmar. Fallar no revierte dinero/stock; requieren futura cola explícita de
  reparación antes de describir recuperación automática.

## Consecuencias

- Venta pasa a `partially_refunded` y finalmente `refunded` sin destruir originales.
- Informes, recibos, fiscalidad, contabilidad, privacidad, Companion y cierre
  consumen retornos normalizados congelados; historia conserva fallback acotado.
- El precio del reemplazo no se netea en retorno. Son dos documentos auditables
  ligados para navegar/conciliar.
- Emisión es la base; ADR-0016 suma medio de pago y reversión exacta sin cambiar historia.
- Misma sede es conservador. Cambios entre sedes, pagos externos, notas fiscales
  de proveedor y orden causal remoto siguen pendientes de producto/integración.

## Alternativas rechazadas

- **Mutar venta/líneas:** destruye recibo y confunde transacción con devoluciones sucesivas.
- **Usar catálogo/impuestos actuales:** cambia dinero histórico e impide conciliar componentes.
- **Solo importe devuelto:** no prueba cantidad, lote, serie, pago ni valor de cliente.
- **Reactivar todo lote:** cantidad no vence expiración, cuarentena u otro estado seguro.
- **Cambio neto único:** evita reglas y oculta devolución/reemplazo separados.
- **Campo mutable de crédito:** pierde procedencia y permite sobrescritura entre cajas.
- **Referencia externa prueba reembolso:** un registro local no demuestra movimiento del proveedor.

## Verificación

- `packages/server/src/__tests__/partial-returns.test.ts`
- `packages/server/src/__tests__/application-sales-returnSale.test.ts`
- `packages/server/src/__tests__/sales-command-result-ref.test.ts`
- `packages/server/src/__tests__/operation-journal.test.ts`
- `packages/server/src/__tests__/reports-accounting.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/sales/RefundConfirmOverlay.test.tsx`
- `apps/web/src/features/sales/SaleDetailsModal.test.tsx`
- `e2e/web/business.spec.ts`
- `e2e/web/checkout-approvals.spec.ts`
- `e2e/electron/refund.spec.ts`
- `pnpm run ci:server`
- `pnpm run ci:web`
- `pnpm run ci:desktop`
- `pnpm run test:e2e:web`
- `pnpm run test:e2e:electron`
