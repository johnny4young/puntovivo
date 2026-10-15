# 0009: almacenamiento y validación de dinero

**Idioma:** Español · [English](../../architecture/0009-money-storage-and-validation.md)

> Estado: aceptada
> Fecha: 25 de mayo de 2026

## Contexto

Puntovivo guarda dinero SQLite en ventas, cotizaciones, pagos, caja, inventario,
fiscalidad y crédito. JavaScript flotante y `real` pueden acumular fracciones
menores de centavo sin un contrato común. El esquema también necesita moneda
explícita antes de admitir liquidación multimoneda segura.

## Decisión

1. Precios/importes conservan `real` SQLite. Pools exactos de valor de inventario
   y sus movimientos/líneas congelados agregan centavos enteros; un costo
   unitario redondeado no reconstruye residuos tras una transformación fraccionaria.
2. Las escrituras normalizan con `roundMoney()`, mitades alejándose de cero.
3. Restricciones `CHECK` exigen no negativos y dos decimales donde lo requiere el dominio.
4. Ventas, líneas, cotizaciones, artículos, productos y límites de crédito
   llevan moneda explícita; tasas de cambio positivas.
5. `tenants.default_currency_code` refiere `currency_catalog`; resuelve
   `packages/server/src/lib/currency.ts`.
6. Identidad fiscal usa `fiscal_identification_types(country_code, code)` por país.
7. Adaptadores mapean estados a la unión fiscal canónica sin expandir lógica por autoridad.

## Invariantes de escritura

- Redondea cada línea antes de acumular y normaliza cabeceras al insertar.
- Conserva signo solo donde el dominio lo permite.
- Padre/hijos usan misma moneda y metadatos de liquidación.
- Caja usa redondeo SQL dentro de transacción.
- Resuelve moneda en el negocio activo, nunca desde otro negocio ni entrada del renderer.

## Límites actuales

La moneda registra denominación; todavía no aporta origen de tasas, flujo FX,
contabilidad de spread ni informes multimoneda. CLP y otras monedas sin dos
decimales requieren evolucionar `roundMoney` según exponente. Las brechas están
en [`../PROJECT-STATUS.md`](../PROJECT-STATUS.md).

## Valores exactos de inventario

Pools globales separan valoración y COGS comercial; lotes y series conservan
su propia autoridad de costo. Consumo parcial asigna el pool actual y la última
unidad física recibe centavos remanentes. Ventas, devoluciones, transferencias,
compras y conteos congelan asignación sin multiplicar después costo mutable redondeado.

Filas de stock y total de todas las páginas comparten valor redondeado por
producto. Vencimientos lee centavos adoptados del lote, incluso cero conocido;
solo legado desconocido usa cantidad por costo. Leer no adopta ni reescribe historia.

Cambiar seguimiento de stock/lote/serie exige saldos por sede, reservas e
identidades con valor vacíos. Total global cero no basta: sedes compensadas
pueden tener inventario. La transacción revalida y rechaza stock anónimo simultáneo
al pasar a lote/serie o servicio.

`0089_inventory_value_constraints.sql` agrega `CHECK`s por fila a campos aditivos:
enteros SQLite en rango exacto JavaScript; revisiones enteras seguras no negativas;
cursores finitos. Grupos nullable son totalmente desconocidos o presentes;
un pool vacío no retiene valor. NULL históricos no se convierten en cero.
Pools globales y deltas firmados conservan política negativa; lotes/series,
no negativos. La transacción, no CHECK entre tablas, coordina saldo físico/pool.

Reconstruir tablas conserva rowids de producto, hijos y triggers de búsqueda/
custodia. Solo triggers FTS farmacéuticos externos temporalmente dependientes
se retiran/restauran transaccionalmente. El wrapper desactiva FK antes de
`BEGIN`, restaura después y verifica integridad referencial. Valores históricos
parciales inválidos abortan; no se adivina reparación ni nuevo significado financiero.

## Consecuencias

`real` conserva consultas numéricas cómodas, pero redondeo y restricciones deben
seguir alineados. Instantáneas exactas son una adición acotada, no migración
general de exponentes ni reescritura de ventas históricas.

## Verificación

Protegen el contrato las suites de dinero, moneda, catálogo/estado fiscal y
restricciones en `packages/server/src/__tests__/`, más dinero compartido en
`packages/shared/src/`. Inventario prueba CHECK migrados, rowids con huecos e
hijos históricos, FTS/custodia restaurados y rollback de base histórica incompleta.

## Alternativas rechazadas

- **Flotantes sin restricciones:** permiten divergencia financiera silenciosa.
- **Dinero en texto:** debilita rangos, agregados y orden.
- **Cambiar inmediatamente todo a unidades menores enteras:** alto riesgo antes de terminar exponentes por moneda.
- **Tablas fiscales por proveedor:** filtran vocabulario de autoridad a toda lectura en vez de contenerlo en adaptadores.
