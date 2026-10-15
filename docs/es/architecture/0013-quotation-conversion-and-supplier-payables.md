# 0013: conversión de cotizaciones y cuentas de proveedores

**Idioma:** Español · [English](../../architecture/0013-quotation-conversion-and-supplier-payables.md)

> Estado: aceptada
> Fecha: 31 de agosto de 2026

## Contexto

Antes una cotización podía marcarse `converted` sin probar venta. Incluso si la
interfaz luego vendía, reintento o caja concurrente podía separar inventario,
caja, impuestos y estado. Las líneas antiguas tampoco identificaban unidad exacta.

Una compra prueba recepción, no factura, vencimiento, notas de crédito o pagos.
Inferir deuda de toda compra histórica inventaría obligaciones y no representaría
saldos iniciales o documentos externos.

## Decisión

### Conversión de cotización

- Líneas nuevas congelan `unit_id` y `unit_equivalence` junto con cliente,
  sede, nivel de precio, moneda, importes, descuentos e impuestos.
- Solo `sales.create` convierte. La entrada normal lleva cotización y línea de
  origen; series requeridas son despacho, no cambio de términos comerciales.
- Bajo `BEGIN IMMEDIATE`, relee cotización del negocio y exige aceptada,
  instante ISO válido no vencido, misma sede/cliente/nivel/moneda e identidad,
  cantidad, unidad, precio, descuento e impuesto exactos.
- Venta, inventario/caja, auditoría, estado de cotización y fila inmutable
  `quotation_sale_links` confirman juntos. Índices únicos de cotización y venta
  garantizan uno a uno. Un competidor pierde sin escribir parcialmente. Sync y
  finalización canónica del sobre ahora también ocurren bajo ese escritor,
  antes del commit: fallar intención revierte conversión; reproducir devuelve
  resultado confirmado sin otra venta.
- `converted` ya no es transición manual. Historia convertida sigue legible,
  sin inventar vínculos.

`0051` completa unidad antigua solo si el producto tiene una base explícita
única. Ambigüedad conserva `NULL` y bloquea conversión, sin adivinar.

### Cuentas por pagar a proveedores

- `provider_payable_invoices` registra cargo. Factura ordinaria puede ligar
  una compra completada del mismo negocio/proveedor; `opening_balance` representa
  historia ingresada por operador con nota explícita.
- `provider_payable_payments` y `provider_payable_credits` son fuentes inmutables;
  cada una se asigna completamente al crear mediante `provider_payable_allocations`,
  sin exceder pendiente de factura.
- Pago `cash` requiere caja abierta del operador y escribe `paid_out` vinculado
  en la misma transacción. Otros medios no cambian cajón.
- Saldo derivado: `invoice charges - allocated payments - allocated credits`.
  Antigüedad usa vencimiento congelado. Fechas de documento, vencimiento, pago y
  crédito son días del calendario del negocio, no instantes UTC; hoy se resuelve
  en su zona. El estado ordena cargos antes de reducciones del mismo día.
- Migrar no deriva deuda desde compras; aparecen como candidatas para factura explícita.
- Factura, apertura, pago y crédito usan sobre ADR-0002. Filas, asignaciones,
  auditoría, sync y respuesta reproducible comparten transacción.
- Gerentes/administradores operan cuentas. Crear/editar/borrar proveedor y
  asignar categorías sigue solo administrativo; la ruta gerente ofrece
  directorio mínimo de solo lectura y cuenta. Proveedores inactivos siguen
  visibles para liquidar obligaciones antiguas.

Toda entrada monetaria es exacta en centavos y usa `roundMoney` de ADR-0009.
Consultas/padres se limitan al negocio; sede proviene de activa autenticada o compra probada.

## Consecuencias

- Términos aceptados no se editan al cobrar; revisa cotización antes de aceptar.
- Pagos son evidencia local; no prueban transferencia/medio externo liquidado
  ni sintetizan extracto o asiento de contabilidad general.
- El libro admite liquidación parcial por varias fuentes inmutables, cada
  fuente completamente asignada e idempotente.
- La venta convertida se descubre por vínculo único aunque termine el proceso
  durante notificaciones posteriores. El ciclo migrado conserva idempotencia
  transaccional y respuesta pública exacta; el vínculo es prueba independiente.
- La interfaz asigna pagos/créditos primero al más antiguo. No hay anulación/
  reversión dedicada aún: una entrada equivocada no se compensa inventando un
  documento del proveedor; corregir sigue siendo una brecha explícita.

## Alternativas rechazadas

- **Convertido manual:** puede afirmar conversión sin venta o fallar después de vender.
- **Otro cobro de cotización:** duplica transacción y permite divergir caja,
  fiscalidad, stock, series o lotes.
- **Completar unidades desde catálogo actual:** cambios posteriores no prueban unidad histórica.
- **Toda compra es deuda:** inventa fechas, condiciones, créditos, pagos y aperturas.
- **Saldo mutable único:** pierde documentos, antigüedad, asignación y reproducción.
- **Abrir página administrativa a gerentes:** concede mutaciones de catálogo ajenas al cobro.

## Verificación

- `packages/server/src/__tests__/quotations.test.ts`
- `packages/server/src/__tests__/provider-payables.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/quotations/QuotationsPage.test.tsx`
- `apps/web/src/features/providers/ProviderPayablesModal.test.tsx`
- `scripts/e2e-baseline-cleanup.test.mjs`
- `e2e/web/quotations.spec.ts`
- `e2e/web/provider-payables.spec.ts`
- `pnpm run ci:server`
- `pnpm run ci:web`
- `pnpm run test:e2e:web`
