# 0018: compras exactas por lote y transformaciones de inventario

**Idioma:** Español · [English](../../architecture/0018-lot-procurement-and-transformations.md)

> Estado: aceptada
> Fecha: 1 de septiembre de 2026

## Contexto

Un saldo de sede solo prueba cantidad, no lote recibido, enviado, llegado ni
insumos de una transformación. Reconstruir identidad después rompería FEFO,
retornos, retiros, vencimiento, costos y reversión exacta.

Cortes de ferretería, rendimiento de carnicería, ensamblajes, porciones y
preparados comparten problema: consumir entradas reales, registrar salida y
desperdicio, repartir costo congelado y confirmar todo o nada. Una plantilla de
catálogo describe producto sin guardar, no aporta esa transacción física.

## Decisión

### Procedencia de compra y devolución a proveedor

- Compra directa o recepción de orden de producto con lotes exige filas concretas
  cuya cantidad base sume la línea recibida. Número, vencimiento, cantidad y
  costo quedan en `purchase_item_lots`; lote de sede y saldo cambian juntos.
- Seguimiento, equivalencia, remanente de orden, lotes y stock se resuelven tras
  reservar escritor `BEGIN IMMEDIATE`. Editar catálogo/recibir concurrentemente
  no cambia significado entre validar y persistir.
- Retorno al proveedor solo elige lotes congelados de esa compra. No excede
  procedencia ni stock exacto actual. `purchase_return_item_lots` congela débito.
  El lote físico conserva costo unitario de recepción; otra recepción de costo
  distinto no se quita al valor original dejando capa combinada.
- Anular compra consume procedencia completa. Identidad faltante, incompleta,
  vieja, renombrada, con otra fecha/costo, vencida, en cuarentena o insuficiente
  rechaza sin recurrir a saldo agregado. Mezclar costo en recepción posterior
  exige compensación explícita, no borrar capa.
- Retornar lote no vendible está permitido, pero número, vencimiento y costo
  actuales deben coincidir con la recepción. ID estable no sustituye identidad
  física ni procedencia de valoración.
- Reposición planea cantidades. Faltante con lotes puede crear borrador porque
  identidad aún no existe; recibir exige asignación completa.
- Conteo físico es distinto: cantidad agregada no reconstruye lote/serie y
  sigue excluyéndolos del conteo ciego agregado.

### Autoridad física por sede y restauración exacta

- `inventory_balances` es autoridad por negocio/sede/producto. Fila ausente
  significa cero allí. Total global solo sirve a informes/instantáneas de
  movimiento; nunca siembra una sede faltante duplicando stock de otra.
- Cada cambio exacto de custodia en compras, transferencias, transformaciones,
  ventas y retornos compara cantidad, costo, estado y vencimiento nullable
  leídos y exige una fila cambiada. Divergencia concurrente/heredada rechaza,
  sin pisar estado nuevo.
- Retorno parcial normalizado o reversión total repone cantidad y costo de
  lote de venta. Si llegaron unidades a otro costo después, pondera costo entre
  actuales y retornadas. Vencimiento/cuarentena siguen mandando; lote ausente
  bloquea. Retornar no inventa lote ni vendibilidad.
- Transferencias validan agregación de solicitud y cantidades guardadas/
  derivadas finitas. SQLite REAL acepta no finitos: overflow/corrupción revierte
  con error estable, sin movimientos inutilizables.

### Custodia entre sedes

- Enviar consume lotes exactos de origen y congela número, vencimiento,
  vendibilidad efectiva, cantidad y costo en `transfer_order_item_lots`.
- Líneas repetidas del mismo producto se consolidan en una mutación. Porciones
  del mismo lote se suman por identidad antes de consumir, sin inventar error de duplicado.
- Inmediata crea/combina destino atómicamente. Diferida mantiene tránsito hasta
  recibir: cada lote enviado aparece exactamente una vez y cantidad recibida
  no excede enviada. Diferencia es explícita, nunca otro lote silencioso.
  Cantidades inferiores a precisión operativa son cero canónico; no se afirma
  recepción positiva sin instantánea de lote de destino.
- Recibir conserva no vendibilidad. Vencido/cuarentena no se activa por mover
  o combinar. Lote destino existente conserva mismo vencimiento, incluido null frente a fecha.
- Anulación exacta congela cantidad anterior/resultante, costo, estado y revisión
  de saldo de destino. Solo restaura capa anterior si identidad, fecha,
  cantidad, costo y revisión monotónica siguen actuales. Cuarentena/vencimiento
  posteriores siguen unidades al origen y al residual del destino. Todo cambio
  intermedio rechaza, incluso secuencia ABA que conserva valor.
- Si recibir diferida registra faltante, anular devuelve solo lo llegado.
  Lo perdido sigue merma; no recrea unidades no disponibles en destino.
- No cambia seguimiento stock/lote/serie con custodia en tránsito. Recepción,
  devolución y anulación también exigen modo actual coherente con procedencia
  congelada, sin fallback agregado. Cada transición rechaza independientemente
  mutar stock si corrupción/legado convirtió producto en servicio.
- Cada outbox de transferencia lleva cabecera, líneas, lotes y puentes de series
  confirmados como agregado versionado. Resolver remoto/combinado espera codec
  entrante atómico completo; subir intención local sigue disponible.

### Recetas y ejecuciones

- Receta del negocio, global o por sede, define entradas/salidas únicas de stock
  en base. Salidas tienen peso positivo y rol principal, subproducto o remanente.
  Versiones optimistas permiten desactivar sin cambiar historia.
- Series, servicios y padres de variante no son identidades válidas. Transformar
  series no está admitido: cantidad sola no prueba cuáles se consumen/crean.
- Ejecutar coincide una vez con cada línea congelada. Consume sede actual,
  exige lotes vendibles exactos, crea identidad nueva por salida con lotes y
  congela entrada/salida, número/vencimiento/estado de lote, identidad de salida,
  costo, rol, nota, actor y desperdicio.
- Desperdicio es subconjunto ya consumido, por entrada y lote; nunca descuenta stock otra vez.
- Costo total suma filas monetarias con redondeo seguro a centavos. Lotes
  congelan costo físico exacto; ordinarios, base de valoración `initialCost`,
  no un costo comercial distinto. Centavos enteros y mayores residuos
  fraccionarios en orden estable dejan asignaciones no negativas y suma exacta,
  incluso muchas salidas pequeñas. Cantidades conservan precisión independiente.
  Asignación y recepción/restauración exigen representación de centavos entera
  segura finita antes de escribir: overflow o magnitud sin centavos exactos
  rechaza, sin confiar en REAL no finito.
- Cada salida congela ambas bases de costo antes/después. `cost` e `initialCost`
  se ponderan separadamente contra stock existente con importe exacto asignado,
  antes del residuo de representación unitaria de dos decimales. Actualizan
  junto con revisión sync. Lista, conteo y KPI reflejan transformación sin
  colapsar campos que pueden diferir legítimamente.
- Ejecución, saldos, lotes, costos, movimientos firmados, auditoría, sync,
  replay canónico e idempotencia confirman en un `BEGIN IMMEDIATE`.
- Outbox de receta/ejecución lee cabecera e hijos confirmados dentro de la
  transacción, incluidos IDs generados, particiones de lotes, costo, desperdicio
  y revisión resultante. Entrada cruda no es instantánea replicable.
- Aplicación remota/combinada de ambos agregados espera codec que valide
  negocio y confirme padre/hijos atómicamente. No bloquea subida; evita aceptar
  silenciosamente un agregado incompleto desde conflictos.
- Ejecución completada es inmutable. Anular es reversión conservadora: lotes
  de entrada conservan producto/número/vencimiento; revisión de saldo de salida,
  ambas bases de costo y revisión sync monotónica, identidad, fecha, estado,
  cantidad y costo de lotes deben igualar resultado congelado. Revisión cierra
  ABA con valor igual. Si no, rechaza. Éxito retira salidas intactas, repone
  lotes/costos, compensa movimientos y conserva original/actor/motivo.
  CHECK de base exige conservación de costo, metadatos válidos y grupos completos de instantáneas.

### Límite de lectura e interfaz

- Gerentes/admin configuran, ejecutan, inspeccionan entradas/salidas/desperdicio
  exactos y piden anulación protegida desde Inventario.
- Lecturas de compra separan derecho no devuelto y cantidad retornable en sede.
  Ordinarios usan stock actual; series, identidades elegibles de compra; lotes,
  solo recepción aún presente cuyo producto, sede, número, fecha y costo
  redondeado coinciden. Detalle/retorno usan la segunda: consumir, mover, mezclar
  o cambiar identidad no deja stock disponible solo porque no se devolvió antes.
  Es proyección, no bloqueo; comando relee bajo escritor y manda ante concurrencia.
  Presupuesto retornable limita opciones de lote: estado, seguimiento o saldo
  divergente no deja lotes positivos con línea retornable cero. Detalle está
  inmediatamente stale, sin heredar caché global de cinco minutos; reabrir tras
  otro flujo relee. Contenido cacheado/controles de débito permanecen ocultos
  mientras carga o falla. El contrato vivo conserva detalle de cuatro unidades
  en la SPA, consume lote transformándolo y reabre dentro de esa ventana: solo
  acepta proyección fresca cero sin acción de retorno.
- Listas acotadas por negocio/sede. Recetas cargan cabeceras, entradas y salidas
  en tres consultas agrupadas, no una por receta. Búsqueda y `hasMore` evitan ocultar resultados por límite.
- Búsqueda de catálogo es del servidor, sin limitar receta a primera página.
  Lotes vienen de lectura actual, pero servidor revalida identidad dentro de escritura.

## Consecuencias

- Compra, transferencia y transformación concilian lote con saldo por sede/global tras recargar.
- Borrador no inventa lote futuro; recepción no borra diferencia entre plan e identidad física.
- Salida tiene costo de entrada congelado defendible, sin duplicar desperdicio;
  valoración sigue visible tras recargar, no conserva valor anterior del producto.
- Actividad posterior ordinaria puede impedir reversión exacta. Requiere
  compensación explícita posterior, no reescribir procedencia.
- Es base operativa, no planificación industrial, pronóstico, programación de
  órdenes, nutrición, política farmacéutica de retiro ni certificación legal de producción.

## Alternativas rechazadas

- **Solo cantidad de compra/transferencia:** pierde lote y permite usar otro al devolver/anular.
- **Lote sintético automático:** inventa evidencia no observada.
- **Reactivar al recibir destino:** borra vencimiento/cuarentena por mover stock.
- **Cortar en plantilla de producto:** no prueba atomicidad de entrada/salida/desperdicio/costo/reversión.
- **Recalcular historia desde receta/catálogo actual:** configuración mutable reescribe evidencia.
- **Anular con mejor esfuerzo:** reversión parcial duplica stock o separa costo y salida que lo originó.

## Evidencia de verificación

- `packages/server/src/__tests__/lot-procurement-transfers.test.ts`
- `packages/server/src/__tests__/inventory-transformations.test.ts`
- `packages/server/src/__tests__/purchases.test.ts`
- `packages/server/src/__tests__/orders.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `packages/server/src/__tests__/migrations-parity.test.ts`
- `apps/web/src/features/inventory/InventoryTransformationsPanel.test.tsx`
- `apps/web/src/features/inventory/InventoryControlPanel.test.tsx`
- `apps/web/src/features/orders/OrderReceiveModal.test.tsx`
- `apps/web/src/features/purchases/PurchaseFinalizeModal.test.tsx`
- `apps/web/src/features/purchases/PurchaseReturnModal.test.tsx`
- `apps/web/src/features/purchases/PurchaseDetailsContent.test.tsx`
- `apps/web/src/features/purchases/PurchaseDetailsModal.test.tsx`
- `apps/web/src/features/inventory/InventoryTransferHistory.test.tsx`
- `apps/web/src/features/inventory/InventoryTransferReceiveModal.test.tsx`
- `e2e/web/inventory-transformations.spec.ts`
- `e2e/electron/inventory-transformation.spec.ts`
- Migración `0057_mean_pandemic.sql`.

Prueba contratos locales de software, no lector, balanza, proceso farmacéutico,
línea de producción ni requisito legal de país físicos.
