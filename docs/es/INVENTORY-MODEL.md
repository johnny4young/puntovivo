# Modelo de inventario y unidades

**Idioma:** Español · [English](../INVENTORY-MODEL.md)

Estado: referencia de implementación actual, revisada el 15 de octubre de 2026.
Están disponibles unidades, autoridad de existencias, códigos por empaque,
lotes, consumo FEFO, costo realizado de ventas, logística de series, variantes,
conteos físicos ciegos y borradores de reposición aprobados por el operador.
Las existencias por ubicación/bin siguen pendientes. Se registra la ruta aditiva
para llegar al modelo actual sin una migración total simultánea.

## Motivo

En un POS minorista latinoamericano, unidades y existencias sustentan productos
pesados, ferretería fraccionaria como cable de 2.5 m, empaques unidad/paquete/caja,
lote/vencimiento de alimentos y farmacia y el requisito de código de unidad
estándar en cada línea de factura electrónica fiscal de producción.

## Modelo actual

- `units`: por negocio, `name` + `abbreviation`, más las columnas descritas abajo.
- `unit_x_product`: unidad por producto con `equivalence` respecto de su unidad
  base, `price`, `isBase` y código de empaque.
- `inventory_balances` por sede/producto con `onHand`/`reserved` es la única
  autoridad. `product_stock_totals` es la proyección mantenida por triggers;
  ya no existe la columna heredada `products.stock`.
- `products.tracks_stock`, verdadero inicialmente, permite excluir un servicio
  como mano de obra, entrega o corte de cabello. No tiene filas de saldo, lo
  omite el seeder de sedes, todo escritor lo rechaza mediante
  `assertServiceStockMutationAllowed` en `applyInventoryBalanceDelta` y no aparece
  en existencias ni alertas bajas. Las líneas congelan la política en
  `sale_items.tracks_stock_snapshot` para revertir exactamente el débito original
  aunque cambie el producto. Los joins a `inventory_balances` solo ven productos
  con inventario; los ingresos deben leer `sale_items`. Importación/exportación
  transporta el indicador; importaciones antiguas vacías conservan el valor
  físico predeterminado. Selectores de inventario, compra y orden solo piden
  productos con stock; compras directas y órdenes rechazan servicios antes de
  escribir cabecera o líneas. Ventas y búsqueda general sí devuelven servicios.
- Las líneas (`sale_items`, `purchase_items`, `order_items`, `transfer_order_items`)
  congelan `unitId` + `unitEquivalence` + `quantity` en la unidad elegida +
  `normalizedQuantity` en base. El inventario se mueve en `normalizedQuantity`.
- `products.sellByFraction` + `fractionStep` + `fractionMinimum` gobiernan venta
  pesada; `products.barcode` sigue siendo el código base.
- `products.cost` es mutable; `sale_items.costAtSale` lo congela.
- `products.tracksSerials` condiciona recepción, sede, transferencia, venta,
  devolución, garantía e historia de cada unidad serializada.

### Fortalezas que deben mantenerse

1. **Factores congelados por línea:** cambiar el factor del catálogo nunca
   reescribe historia. Todo escritor nuevo debe conservarlo.
2. **`normalizedQuantity` explícita:** las cuentas usan una cantidad base, sin recalcularla en vivo.
3. **Stock fraccionario controlado:** existencias `real` y política fraccionaria.

## Estructura del modelo

```
unit_dimension  (mass|volume|length|area|count|time|other)
      │  canonical reference: mass→gram, volume→ml, length→m, area→m², count→unit
      ▼
units ── dimension, standard_code (UN/ECE Rec 20), reference_factor ──▶ fiscal unitCode
      │
      ▼
unit_x_product ── equivalence (→ product base), price, isBase, barcode (per pack level)
      │
      ▼
inventory_balances (authoritative)  ── site, product, [location], onHand, reserved
      │                                    └─ lot dimension (Phase C): lot_no, expiry, cost_layer
      ▼
cost layers (Phase C: FIFO / weighted-average) ──▶ auditable COGS
```

## Base actual de unidades disponible

Aditiva, sin reescritura. Migración `0003_unit_dimension_standard_code`.

- `units.dimension`: magnitud física, enum nullable.
- `units.standard_code`: código UN/ECE Rec 20 (`KGM`, `LTR`, `MTR`, `GRM`,
  `C62`/`H87` para piezas). Es el vínculo fiscal: la facturación latinoamericana,
  como DIAN UBL, requiere `unitCode` estándar por línea; una abreviatura libre no basta.
- `units.reference_factor`: multiplicador de referencia (`KGM`=1000, `GRM`=1).
  Permite futura conversión por dimensión sin factores por producto; null conserva la ruta heredada.
- `services/units/unit-standards.ts` mapea unidades comunes a dimensión/código/factor.
  `resolveUnitStandardCode()` es lo que consumirá un adaptador DIAN en vez de
  adivinar nombres; el matching por texto de `mapUnitToUnmdItem` del pack CL es
  el patrón que reemplaza. `dimensionsAreCoherent()` detecta conjuntos incoherentes.
- `units.create` completa los tres datos omitidos desde catálogo: «KG» recibe
  metadatos estándar. La entrada explícita siempre prevalece.

## Fase B: autoridad de existencias y códigos de empaque disponibles

1. **Código por nivel de empaque completo.** `unit_x_product.barcode`, agregado
   por `0004_unit_x_product_barcode`, permite un código por empaque.
   `products.lookupByBarcode` busca empaque si no coincide el producto base y
   devuelve `resolvedUnitId` / `resolvedUnitPrice`; el lector POS elige esa unidad,
   de modo que una caja agrega `equivalence` unidades base al precio de caja.
   `products.barcode` conserva compatibilidad como código base.
2. **Autoridad única completa.** Se eliminó `products.stock` en
   `0007_drop_products_stock`, que primero creó saldos `inventory_balances` de sede primaria desde
   valores antiguos y luego quitó la columna. `inventory_balances.on_hand`
   por sede es la autoridad; `Σ(on_hand)` se deriva mediante
   `services/inventory-balances/derive.ts`: `productStockTotalSql` en proyecciones,
   `getProductStockTotal`/`getProductStockTotals` en escrituras. Las lecturas
   siguen exponiendo `stock` numérico derivado, sin cambiar forma de API.
   Ya no se escribe `products.stock`; ventas valida `inventory_balances`.
   `reconcileProductStockFromBalances` y el informe de discrepancias permanecen
   sin cambios/sin filas porque esa divergencia ya no es estructuralmente posible.
   El total de negocio/producto se materializa en `product_stock_totals`,
   mantenido exclusivamente por triggers de `0008` al insertar, cambiar on_hand
   o borrar `inventory_balances`. `derive.ts` hace lookup de PK O(1), sin sumar
   por producto. Los triggers cubren transferencias, seeders y unas 60 pruebas
   que escriben `on_hand` fuera de `applyInventoryBalanceDelta`. La paridad se
   protege en `inventory-stock-rollup.test.ts`.
3. **Detalle por ubicación/bin pendiente:** `inventory_balances` reserva ese
   nivel en su comentario de diseño; todavía no está iniciado.

## Control minorista disponible

1. **Conteos físicos ciegos.** `inventory_count_sessions` controla el flujo por
   sede y `inventory_count_lines` congela unidad base, existencia contable
   firmada, revisión de saldo y costo unitario al abrir. El valor inicial
   firmado permite reparar un saldo negativo histórico; la cantidad física
   observada sigue siendo no negativa, normalizada a `0.001`. La lectura del
   contador muestra nombres/cantidades ingresadas y oculta esperados, diferencia
   y costo hasta enviar. Sesiones/líneas tienen versiones optimistas; un solo
   conteo sin terminar puede incluir un mismo producto/sede.
2. **Aprobación cerrada ante inconsistencias.** Enviar calcula diferencia
   congelada; aprobar reserva el escritor SQLite y exige saldo y revisión
   monotónica idénticos a las instantáneas de apertura. También exige unidad base
   activa y política originales. Venta, devolución, recepción, transferencia,
   ajuste o cambio de identidad obliga a reiniciar, incluso con movimiento neto
   cero. Escribe entrada `physical` por línea y movimiento de ajuste solo con
   discrepancia no nula; saldo, auditoría, sincronización, resultado idempotente
   y transición confirman juntos. Rechazar un conteo enviado no cambia stock.
3. **Identidad.** Admite productos estándar e hijos de variante vendibles.
   Excluye servicios, padres de variante, lotes y series porque un total no
   prueba identidad física. Conteos conscientes de lote/serie siguen separados,
   sin inferir evidencia.
4. **Reposición sugerida.** Calcula `available = max(on_hand - reserved, 0)`
   y agrega cantidades base no recibidas de órdenes borrador, enviadas y
   parcialmente recibidas. Bajo `min_stock` propone cantidad; el gerente elige
   proveedor y crea borrador. No cambia stock ni deuda, no puede recibirse y se
   descarta con seguridad; enviar explícitamente activa la recepción. Faltantes
   con lotes pueden generar borrador; la identidad concreta se exige al recibir,
   no se inventa al planear. No se ordena ni pronostica demanda automáticamente.

## Fase C: lotes, vencimiento, costo y logística de series disponibles

1. **Base de lotes/vencimientos completa.** `inventory_lots` guarda sede,
   producto, lot_no, expiry, on_hand, unit_cost y status; `products.tracks_lots`
   es opcional desde `0005_inventory_lots`. Cantidad/costo son por unidad base,
   comparables con `inventory_balances`.
   - `services/inventory-lots/select-fefo.ts` asigna FEFO de forma pura y probada:
     ordena por vencimiento, null al final, y recepción; consume en orden.
     El `unit_cost` del lote es su capa: `totalCost` es costo exacto de venta y
     `weightedAverageUnitCost` aporta el promedio para el asiento combinado.
   - `receiveInventoryLot` inserta/actualiza lote: suma y pondera costo al repetir recepción.
   - Router `inventoryLots`: `receive` para manager/admin, `list` ordenado FEFO
     y `expiring` para alertas por ventana de días.
   - Sincronización registra `inventory_lots` con política `manual`.
2. **Motor de costos completo.** FEFO genera COGS auditable por capas reales,
   no solo `products.cost` mutable. El helper combinado cubre informes de promedio ponderado.
3. **Consumo de ventas completo.** Con `products.tracks_lots`, `runFreshSale`,
   punto único de débito para venta directa y borradores, consume FEFO dentro
   de la transacción, descuenta lotes, los agota al llegar a cero y escribe
   `sale_item_lots` por lote mediante `0006_sale_item_lots`. Esto prueba lote,
   cantidad y costo. Solo vende lotes activos no vencidos. Falta contra saldo
   agregado aborta todo con `LOT_STOCK_INCONSISTENT`: no se confirma stock sin
   procedencia completa. Devolver una venta completada normalizada repone
   cantidades elegidas a sus lotes congelados y guarda procedencia inmutable;
   devoluciones parciales acumuladas no exceden asignación original. Anular
   todo/descartar borrador usa `restoreLotsForSale`, repone lotes y elimina
   procedencia abandonada. Reponer cantidad no libera cuarentena ni vencimiento;
   solo reactiva un lote agotado aún válido. `sale_items.costAtSale` conserva
   la instantánea de `product.cost`; el COGS exacto está en `sale_item_lots`
   para informes sin regresión del campo existente.
4. **Series y logística completas.** `product_serials` conserva negocio,
   producto, sede, estado, costo de adquisición, recepción, venta, devolución
   y garantía por unidad. Compra, transferencia exacta, selección al cobrar,
   reversión y garantía preservan propiedad negocio/sede e historia persistente.
   `sale_item_serials` conserva asociaciones previas aunque una unidad devuelta vuelva a venderse.

Los informes de margen/COGS de `sale_item_lots` también están disponibles.
`reports.profit.margin` y Rentabilidad administrativa (`/profitability`) muestran
margen realizado por fechas: costo del libro de lotes si corresponde y de
`cost_at_sale` en otro caso. Ingresos por producto excluyen impuestos congelados,
importes devueltos y descuento de ticket no devuelto. El cobro pertenece a su
fecha de finalización y cada devolución normalizada a su propia fecha. Posiciones
inicial/final usan cantidades, impuestos y costos congelados en esos límites;
una devolución posterior no cambia un informe anterior. Períodos con solo
retornos pueden tener cantidad, ingreso y COGS negativos. Valores brutos
remanentes ponderan descuento de ticket por límite; redondeo acumulado por ID
estable conserva centavos antes de ordenar productos o limitar resultados.
COGS adoptado conocido en cero no recurre a costo viejo del catálogo. La consulta
acotada del cajero nunca expone COGS. Propinas/cargos de servicio quedan fuera
del margen por producto; caja/ticket conserva totales cobrados. Ingreso o ganancia
negativa se conserva; el porcentaje es cero si ingreso neto no es positivo.
Nunca se recalculan impuestos/costos históricos desde catálogo. Todas las lecturas
comparten instantánea SQLite diferida: anulación o devolución concurrente no
mezcla elegibilidad de líneas con costos de otro estado confirmado.

## Principios de migración sin cambio total simultáneo

- **Primero aditivo:** columnas nullable y tablas nuevas; ningún ALTER destructivo
  de tabla activa. Cada fase debe migrar limpiamente una base 1.x poblada.
- **Instantáneas:** las líneas congelan factores y costos al escribir.
- **Completar sin bloquear:** enriquecer dimensión/código es de mejor esfuerzo;
  null nunca impide escribir.
- **Una fase por PR**, aprobada en `ci:server` + `ci:web` + `ci:desktop`,
  para localizar una regresión mediante bisección.
