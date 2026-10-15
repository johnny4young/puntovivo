# 0016: promociones autoritativas y medios de valor del cliente

**Idioma:** Español · [English](../../architecture/0016-server-authoritative-promotions-and-customer-value.md)

> Estado: aceptada
> Fecha: 1 de septiembre de 2026

## Contexto

Una promoción cambia dinero adeudado. Resolver producto, categoría, sede,
cliente, cantidad, tiempo y lote en renderer confiaría precio a un cliente
viejo/modificado. Aplicar una regla nueva sin vista previa también permitiría
confirmar un total nunca presentado.

Puntos y crédito son pasivos semejantes a dinero. Un saldo mutable no prueba
qué venta consumió, qué devolución repuso ni qué caja ganó al gastar el saldo
final. Devolver/anular distingue valor usado y puntos ganados por el mismo ticket.

## Decisión

### Cotización autoritativa de promociones

- Ciclo explícito versionado: borrador, activa, pausada y archivada. Un borrador no cambia precio.
- Clientes modernos piden cotización tras resolver/validar entradas del carrito.
  Envían fingerprint y total con venta. Bajo escritor se reevalúan reglas,
  ámbito, ventana temporal y lotes; evidencia vieja se rechaza. Clientes sin
  fingerprint conservan comportamiento anterior sin promoción.
- Destinos nullable de producto/categoría, sede, cliente, tiempo y mínimo combinan
  con AND. Producto/categoría son excluyentes. Prioridad descendente, luego
  especificidad; una regla exclusiva detiene combinación.
- Descuento manual primero, todavía sujeto a aprobación. Promociones reducen
  secuencialmente el remanente. Descuento efectivo sigue legible para retornos/
  clientes antiguos; tasa manual y cada aplicación se congelan separadamente.
- Cotización aceptada omite promociones dinámicas por términos ya inmutables.
  Borradores suspendidos cotizan sus líneas persistidas y exigen fingerprint al completar.
- Vencimiento solo sugiere hasta convertirlo un gerente. La promoción se liga
  al lote y solo aplica si FEFO satisface toda la línea con ese lote activo no
  vencido. Farmacia rechaza conversión: vencimiento regulado no es marketing.

### Núcleo de medios de valor del cliente

- `loyalty` y `store_credit` son medios de pago de primera clase. Crédito usa
  cuenta por negocio/cliente/moneda. Usar puntos exige activación explícita y
  valor positivo configurado por punto entero; no se inventa tasa.
- El servidor deriva dinero y revalida saldo. Venta, pago, movimiento, saldo
  materializado, sync, resultado idempotente y auditoría comparten
  `BEGIN IMMEDIATE`: gastar el último saldo concurrentemente tiene un ganador.
- Devolver asigna medios originales acumulativamente y repone puntos/crédito
  al movimiento exacto, independientemente del destino elegido para pagos
  externos. Retira puntos ganados por la porción devuelta. Anular restaura
  valor usado y revierte lo ganado una sola vez.
- Deuda legítima por retorno conserva evidencia si el cliente ya gastó puntos
  posteriores. Nuevos usos y ajustes negativos no la agravan; ganancia futura la amortiza.
- Se ganan puntos sobre venta liquidada excluyendo lo pagado con puntos. Crédito
  de tienda sí integra la base porque es valor previo gastado, no otro uso de puntos.

### Persistencia, replicación y presentación

- Aplicaciones viven en instantáneas normalizadas inmutables por línea. El
  descuento compatible resume; no identifica la promoción.
- Reglas/instantáneas usan conflicto manual. Precio divergente no se resuelve
  como catálogo por último escritor. Cuentas/movimientos emiten intención
  determinista dentro de venta/devolución/anulación.
- Historia, recibos, privacidad, contabilidad y cierre usan evidencia congelada.
  Puntos/crédito mapean pasivos configurados, no efectivo ni procesador externo.
- Cajero solo lee proyección acotada de uso necesaria. Ciclo y conversión por
  vencimiento son manager/admin; toda consulta mantiene negocio/sede.

## Consecuencias

- Cobro no acepta silenciosamente una promoción cambiada tras revisar; refresca cotización.
- Venta conserva intención manual y regla/versión exacta por línea.
- Venta, retorno y anulación de valor son trazables y seguros al repetir;
  reembolso de tarjeta sigue evidencia externa, no transferencia afirmada.
- Solo se declaran reglas porcentuales. No implica cupones, compra-X-lleva-Y,
  liquidación financiada por proveedor ni descuentos farmacéuticos regulados.
- Intención sync y clasificación manual no prueban aplicación causal ni convergencia remota.

## Alternativas rechazadas

- **Promociones en React:** confía entradas mutables y diverge de impuestos,
  lotes, retornos y recibos.
- **Aplicar silenciosamente al completar:** cambia importe revisado y rompe clientes viejos.
- **Reusar descuento manual:** pierde regla y mezcla precio del dueño con umbrales de prevención.
- **Puntos/crédito como `other`:** oculta pasivos ante retornos, contabilidad,
  recibos y concurrencia.
- **Forzar saldo negativo de retorno a cero:** crea valor y rompe libro;
  rechazar el retorno legítimo bloquearía operación.

## Evidencia de verificación

- `packages/server/src/__tests__/promotions.test.ts` fija ciclo, destinos,
  orden, fingerprint, compatibilidad, lotes/farmacia, instantáneas, negocio y concurrencia.
- `packages/server/src/__tests__/customer-value-tenders.test.ts` fija mezcla,
  saldo final concurrente, borradores, retornos parciales/finales, anulación,
  replay, libro, privacidad, contabilidad y sync.
- `e2e/web/retail-promotions-loyalty.spec.ts` configura/activa como gerente,
  cobra puntos+crédito+tarjeta, verifica SQLite, recarga EN/ES, devuelve todo,
  registra referencia externa y restaura saldos iniciales.
