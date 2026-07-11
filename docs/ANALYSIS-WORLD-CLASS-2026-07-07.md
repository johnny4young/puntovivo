# Análisis World-Class — 2026-07-07

> Refinamiento del análisis profundo (sucesor de `AUDIT-2026-07-02.md`), corrido
> sobre `main @ 583c9a4` (post-merge PR #132: units/lots/FEFO + reporte de
> margen + hardening). Método: 3 barridos paralelos del repo (producto/razón de
> ser · UX/librerías · arquitectura/hot-spots) + hallazgos verificados de la
> sesión (modelo de inventario, sync contract, fixes de review).
>
> **Objetivo**: propuestas claras, concisas, sin ambigüedades y realizables,
> listas para ejecutarse en una segunda iteración. Cada propuesta lleva id
> `WC-XN`, esfuerzo (S ≤ 1 día · M ≤ 1 semana · L > 1 semana), archivos
> concretos y criterios de aceptación.

---

## 0. La razón de ser (ancla de todo lo que sigue)

README, verbatim: _"Puntovivo is a local-first, fiscal-native POS for Latin
American retail operators. The first sellable wedge is Colombia retail for
1-10 site stores: fast checkout, cash accountability, site-owned stock,
auditability, fiscal readiness, and offline local authority before cloud
expansion."_

Los 6 pilares del wedge — cada propuesta de este doc está etiquetada con el
pilar que potencia:

| Pilar                   | Tag          |
| ----------------------- | ------------ |
| Checkout rápido         | `[checkout]` |
| Responsabilidad de caja | `[caja]`     |
| Stock veraz por sede    | `[stock]`    |
| Auditabilidad           | `[audit]`    |
| Preparación fiscal      | `[fiscal]`   |
| Autoridad local offline | `[offline]`  |

**Tesis del análisis**: el diferencial real contra Loyverse (competidor más
cercano) y Siigo/Alegra (dueños del wedge contable local) no es tener más
features — es que **la caja nunca se detiene y el dueño sabe cuánto ganó**.
Los cimientos ya existen (offline-first, per-lot COGS desde ENG-190, outboxes
durables). Lo que falta es (a) cerrar las 3 compuertas del piloto, y (b)
convertir esos cimientos en experiencias que el operador AME usar.

---

## 1. Scorecard por dimensión

| Dimensión          | Nota | Evidencia clave                                                                                                                                                                                           |
| ------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Funcionalidad**  | 8/10 | Retail core completo (POS, inventario con lotes/FEFO, caja, cotizaciones, fiscal mock, sync, AI OCR/voz). Demo-ready; piloto bloqueado por ENG-057/058/060/061/062.                                       |
| **Usabilidad**     | 7/10 | Teclado endurecido (F1/Ctrl+P/Ctrl+Z, barcode wedge, focus traps), command palette, empty states con nudge. Falta: onboarding guiado, sonido, cierre de día ritual.                                       |
| **Innovación**     | 7/10 | Fiscal-native + offline authority + AI (OCR/voz/copilot) es una combinación que ningún competidor local tiene junta. Pero mucha está gated/invisible.                                                     |
| **Originalidad**   | 8/10 | Ledger COGS por lote en un POS de este segmento es raro (Lightspeed lo cobra caro). Open source + sin fees de transacción = posicionamiento único en LatAm.                                               |
| **UX**             | 7/10 | Design system pv-\* maduro (OkLch, dark mode, motion tokens, contrast gate). Sales route LH 58 (bajo el goal 70). Sin feedback sonoro, sin celebraciones, mobile 5/10.                                    |
| **Performance**    | 7/10 | Presupuestos como gate de CI (bundle/p95/memoria/LH) — nivel world-class de _proceso_. Hot-spot real: subquery correlacionado de stock por fila de producto.                                              |
| **Arquitectura**   | 7/10 | Outbox kernel sólido (4 workers, claim atómico), sandbox Electron pinneado, esquema 102 tablas con índices compuestos. Deuda: capa application/ solo en 3 dominios (17/38 routers van directo a Drizzle). |
| **Escalabilidad**  | 6/10 | Single-writer SQLite + WAL sirve el wedge (1-10 sedes). SSE sin backpressure; sync multi-dispositivo con gaps (enqueue de lotes en venta); spike libSQL (ENG-037) pendiente.                              |
| **Testeabilidad**  | 8/10 | 2 236 server + ~1 650 web + 111 desktop; DB in-memory por archivo; pisos de coverage en CI; golden vectors de dinero. Falta: property-based, contract tests explícitos.                                   |
| **Simplicidad**    | 7/10 | Server bien descompuesto (solo runFreshSale > 500 LOC). Deuda: superficies no-op retenidas (reconcile/discrepancias), 3 tiers de precio + 6 columnas de margen (legacy).                                  |
| **Mantenibilidad** | 8/10 | Convención de markers ENG-NNN, docs de planeación disciplinados, migraciones aditivas, CI por área con path filters.                                                                                      |
| **Librerías**      | 9/10 | React 19.2, Vite 8, TS 6, Tailwind 4, tRPC 11, Zod 4, Fastify 5, Drizzle 0.45, Vitest 4 — todo fresco. Único gate: Electron 42 (better-sqlite3 vs V8 14, ya documentado).                                 |

---

## 2. TRACK P — Lo primero: cerrar el piloto (ya planeado, solo re-priorizar)

No son propuestas nuevas — son las 3 compuertas que SELLABILITY.md marca como
bloqueo del piloto y que deben ir ANTES que cualquier item de este doc:
`ENG-057` (contingencia fiscal + retry), `ENG-058` (prueba fiscal en recibo:
CUFE/QR/XML), `ENG-060/061/062` (impresora ESC/POS, cajón RJ11, scanner USB
HID). **Reframe de marketing incluido**: la contingencia fiscal no es plomería
— es el feature "la DIAN se cayó, tú no" (banner calmado + cola visible +
transmisión automática al volver). Esa narrativa ES el pilar `[offline]`
vuelto ventaja vendible.

---

## 3. TRACK A — Performance y escalabilidad

### WC-A1 · Rollup materializado de stock total `[stock]` — **M**

- **Problema**: `productStockTotalSql` (subquery correlacionado,
  `services/inventory-balances/derive.ts:34`) corre POR FILA en
  `products.list`, dashboard (2×) e inventario. Con 500 productos × 5 sedes el
  dashboard dispara 4+ barridos correlacionados. El propio INVENTORY-MODEL.md
  ya nombra el rollup materializado como escape hatch.
- **Diseño** (write-through, sin triggers SQL — el repo evita DDL mágico):
  1. Nueva tabla:
     ```ts
     export const productStockTotals = sqliteTable(
       'product_stock_totals',
       {
         tenantId: text('tenant_id')
           .notNull()
           .references(() => tenants.id),
         productId: text('product_id')
           .notNull()
           .references(() => products.id, { onDelete: 'cascade' }),
         total: real('total').notNull().default(0),
         updatedAt: text('updated_at').notNull(),
       },
       t => [
         primaryKey({ columns: [t.tenantId, t.productId] }),
         index('idx_pst_tenant').on(t.tenantId),
       ]
     );
     ```
  2. `applyInventoryBalanceDelta` (único punto de escritura de balances) hace
     upsert `total = total + delta` en la MISMA transacción.
  3. Migración `0008`: backfill `INSERT ... SELECT product_id, SUM(on_hand)`
     desde `inventory_balances`.
  4. `productStockTotalSql` pasa a leer `product_stock_totals.total` (join
     simple); `getProductStockTotal(s)` leen la tabla.
  5. El test de paridad: un test que compara rollup vs Σ(balances) tras una
     secuencia de ventas/ajustes/transferencias/reversas.
- **AC**: products.list y dashboard sin subquery correlacionado; paridad
  rollup≡Σ verificada; `ci:server` verde; p95 de `products.list` bajo el
  presupuesto existente (60 ms) con margen.

### WC-A2 · SSE con backpressure y replay `[offline]` — **M**

- **Problema**: `api/realtime` no tiene backpressure ni buffer — un cliente
  lento retiene memoria; un reconnect pierde eventos.
- **Diseño**: ring buffer por tenant (últimos 500 eventos con id monotónico);
  honrar `Last-Event-ID` en reconnect (replay del gap); si un cliente acumula
  > N eventos sin drenar, cerrar su conexión (el cliente ya sabe re-suscribir).
- **Archivos**: `packages/server/src/services/realtime/` (SseManager).
- **AC**: test de reconnect-con-gap recibe los eventos perdidos; test de
  cliente lento se desconecta sin OOM; sin cambios de API para el web.

### WC-A3 · Sales route: Lighthouse 58 → 75 `[checkout]` — **S/M**

- **Diseño**: (1) lazy-load del SalePaymentModal (hoy en el chunk de
  SalesPage); (2) prefetch de `products.list` en idle desde el shell (el
  cajero SIEMPRE va a /sales); (3) auditar el LCP real del route (probable
  culpable: grid de productos sin dimensiones reservadas → ya hay tokens CLS).
- **AC**: `perf-budget.json` sales.score sube de 58 a ≥ 70 y el gate de CI
  se aprieta a ese nuevo piso (no dejar presupuesto flojo).

### WC-A4 · Enqueue de sync en el camino de venta de lotes `[offline][stock]` — **S**

- Ya capturado en BACKLOG (ENG-191 follow-up): `consume-for-sale.ts` marca
  `sync_status='pending'` en el lote pero nunca `enqueueSync`. Cerrar el gap:
  encolar las mutaciones de lote junto al enqueue de la venta (post-commit,
  mismo patrón que `runCompleteDraft.ts:360`).
- **AC**: venta de producto lot-tracked → fila(s) `inventory_lots` en
  `sync_outbox` con snapshot post-commit (on-hand/estado/costo); reversa
  también; test de round-trip.

---

## 4. TRACK B — Arquitectura y mantenibilidad

### WC-B1 · Completar la capa application/ en los dominios calientes `[audit]` — **L (por fases)**

- **Realidad medida**: application/ existe solo para sales (17), cash-sessions
  (7) y purchases (10); 17 de 38 routers consultan Drizzle inline.
- **Regla pragmática** (no big-bang): "toda MUTACIÓN de dinero o stock vive en
  application/; las queries pueden quedarse en el router". Fases: (1)
  inventory (adjust/transfer/receive), (2) products (create/update — ya casi,
  el stock absoluto ya delega), (3) customers (ledger).
- **AC por fase**: la mutación movida conserva byte-igual su transacción;
  tests existentes verdes sin edits; el router queda < 150 LOC por archivo.

### WC-B2 · `packages/shared` para dinero y unidades `[fiscal][caja]` — **M**

- **Problema**: `roundMoney` duplicado (web + server) sostenido por twin
  golden-vector suites — un parche de paridad, no una solución.
- **Diseño**: workspace `packages/shared` con `money.ts` (roundMoney,
  formatQuantity), `unit-math.ts` (normalizedQuantity) y los tipos de dominio
  compartidos que hoy viven en `apps/web/src/types/index.ts`. El server y el
  web lo importan; las suites de paridad se colapsan a UNA.
- **AC**: cero duplicación de la fórmula; `ci:web` + `ci:server` verdes; el
  bundle web no crece (> tree-shaking verificado por el gate existente).

### WC-B3 · Interface `FiscalProvider` formal `[fiscal]` — **M**

- Del gap #1 del audit anterior, sin resolver: definir
  `interface FiscalProvider { submit(doc): Promise<SubmitResult>; poll(id):
Promise<StatusResult>; contingency(doc): ContingencyFolio; retention():
XmlRetentionPolicy }` en `services/fiscal/provider.ts`, implementar el mock
  contra ella y tipear el orchestrator contra la interface. El primer PT real
  (ENG-059) se vuelve un adapter, no un rewrite.
- **AC**: mock y stubs CL/MX implementan la interface; el orchestrator no
  importa ningún adapter concreto; markers ENG-057/020/054 intactos.

### WC-B4 · Desglose de `apps/desktop/src/main/index.ts` (819 LOC) `[offline]` — **S/M**

- Extraer `main/server-lifecycle.ts` (boot/shutdown del Fastify embebido) y
  `main/encryption-setup.ts` (SQLCipher key dance). Meta < 400 LOC. Es el
  archivo que dos veces se peeled del wave ENG-178 — hacerlo en sesión
  dedicada con smoke Electron (`test:e2e:electron`).
- **AC**: suite main-process (111) verde + smoke E2E Electron verde; conteo de
  canales IPC idéntico (ya hay test que lo pinnea).

### WC-B5 · Registrar y podar superficies no-op `[simplicidad]` — **S**

- `reports.inventory.discrepancies` + `reconcileProductStockFromBalances` son
  no-op estructurales post-unificación (el propio doc-comment lo dice). Plan:
  deprecar en el cliente (quitar el botón/panel de Operations), dejar el
  endpoint 1 release más, borrar después.
- **AC**: Operations Center sin panel muerto; endpoints marcados
  `@deprecated`; BACKLOG apunta la fecha de borrado.

---

## 5. TRACK C — UX excesivo (que usarlo sea adictivo)

> Principio: la adicción buena en un POS no viene de gamification barata sino
> de **ritmo** (cero fricción en el loop de venta), **cierre** (rituales de
> fin de día satisfactorios) y **progreso visible** (el dueño ve que gana).
> Todo lo de abajo usa datos que YA existen.

### WC-C1 · Cierre de día en 60 segundos `[caja][audit]` — **M** ⭐

- **Qué**: al cerrar la última sesión de caja del día, una pantalla-ritual:
  ventas del día, **margen bruto real del día** (reports.profit.margin ya lo
  calcula), top-3 productos por ganancia, resultado del cuadre con semáforo, y
  **racha**: "🔥 7 días seguidos cuadrando caja". Botón único: "Cerrar el día".
- **Cómo**: página `DayCloseSummary` que compone 3 queries existentes
  (`cashSessions.close` result + `reports.profit.margin` del día +
  top products). La racha se deriva: N días consecutivos hacia atrás donde
  todas las sesiones cerradas tienen |over_short| ≤ 0.009 — query sobre
  `cash_sessions`, sin tabla nueva.
- **AC**: cerrar sesión navega al ritual; racha correcta ante días sin ventas
  (no rompe la racha) y ante descuadre (la rompe); i18n EN/ES; smoke live.

### WC-C2 · Feedback sonoro del checkout `[checkout]` — **S** ⭐

- **Qué**: beep corto de éxito al agregar ítem por scanner, tono distinto en
  error (producto no encontrado / sin stock), y arpegio sutil opcional al
  completar venta. Ajuste de diseño: el switch es local al dispositivo
  (on/off), porque el sonido pertenece al hardware de la caja, no al tenant.
- **Cómo**: `apps/web/src/lib/sound.ts` con Web Audio API (osciladores — cero
  assets, cero deps); hook en `lookupByBarcode` success/fail y en
  `SALE_COMPLETION`; toggle en el header POS con preferencia en localStorage
  y fallback de sesión si el storage está bloqueado.
- **AC**: apagado por defecto; habilitarlo prueba el speaker en el mismo gesto;
  toggle persiste por dispositivo; audio nunca rompe checkout.

### WC-C3 · Radar de vencimientos accionable `[stock]` — **M** ⭐

- **Qué**: panel "Se vencen pronto" (el endpoint `inventoryLots.expiring` YA
  existe) con CTA por lote: "Sugerir descuento" — regla determinista: ≤ 7 días
  → 30 %, ≤ 15 → 20 %, ≤ 30 → 10 % (configurable). Aceptar crea una nota de
  precio sugerido (v1: badge en POS "sugerido -20 %"; v2: promo real cuando
  exista WC-D1).
- **Cómo**: página/tab en Inventario que consume `inventoryLots.expiring`
  - columna "valor en riesgo" (`on_hand × unit_cost`) para que duela en pesos.
- **AC**: lista FEFO-ordenada con valor en riesgo; CTA registra auditoría;
  EN/ES; smoke live.

### WC-C4 · HUD de cajero (opt-in) `[checkout]` — **M**

- **Qué**: mini-strip en el cockpit: ítems/min de la sesión, tiempo medio de
  checkout, mejor marca personal. Opt-in por usuario (esto motiva, no vigila:
  el dueño NO ve el HUD de otros — eso queda para reportes normales).
- **Cómo**: derivable 100 % de `sales` + `cash_sessions` de la sesión activa
  (timestamps por venta). Hook `useCashierPace` + strip en SalesCheckoutPanel.
- **AC**: cálculo correcto con ventas suspendidas/reanudadas; toggle en perfil
  de usuario; cero costo cuando está apagado.

### WC-C5 · Omnibox de venta `[checkout]` — **M**

- **Qué**: el CommandPalette (ya global) gana un modo venta: desde CUALQUIER
  pantalla, `Ctrl+K` + escanear/escribir un producto lo agrega al carrito
  activo y navega a /sales. "La app entera es una caja".
- **Cómo**: extender el provider del palette con acción `sell:` que llama al
  cart workspace store (zustand, ya persiste) + `lookupByBarcode` existente.
- **AC**: scan desde /inventory agrega al carrito y enfoca /sales; sin robar
  foco de inputs editables (guard existente `isEditableShortcutTarget`).

### WC-C6 · Semáforo de margen en el catálogo (modo dueño) `[stock][audit]` — **S**

- **Qué**: badge de color en tiles/filas de producto según margen real
  (verde ≥ 30 %, ámbar 15-30 %, rojo < 15 %) — solo visible para admin.
  Convierte el ledger de ENG-190 en decisión diaria de compra/precio.
- **Cómo**: el margen por producto ya sale de `reports.profit.margin`
  (rango 30 días); cachear con react-query staleTime 5 min; badge pv-badge.
- **AC**: cajeros NO lo ven; umbrales exportados como constantes (30/15) para
  que un futuro setting de tenant los reemplace sin reescribir la columna;
  EN/ES y error de datos no bloqueante.

### WC-C7 · Primera venta en 5 minutos `[checkout]` — **M**

- **Qué**: onboarding activo (hoy no hay guided tour): checklist viva sobre el
  `setupReadiness` existente — "1. Crea un producto → 2. Abre caja → 3. Haz tu
  primera venta" con estados que se auto-completan y un momento de celebración
  (banner whats-new-style, no confetti) en la primera venta real.
- **AC**: tenant nuevo ve el checklist; cada paso deep-linkea; se auto-oculta
  al completarse; reaparece solo desde ayuda.

### WC-C8 · Pulso diario del negocio `[audit]` — **S (v1)**

- **Qué**: card compartible (imagen/PDF ligero) al cierre: ventas, margen,
  ticket promedio, comparación vs mismo día semana anterior. v1: botón
  "Compartir por WhatsApp" (deep link `wa.me` con texto) — el lane ENG-112
  (WhatsApp real) lo vuelve push automático después.
- **AC**: card generada client-side (canvas/HTML→imagen); texto EN/ES; sin
  datos sensibles de clientes.

### WC-C9 · Contador de caja con semáforo en vivo `[caja]` — **S**

- **Qué**: en el cierre de caja, mientras un manager/admin digita
  denominaciones (la estructura `denominations` ya existe), el delta
  esperado-vs-contado se actualiza en vivo con color. Ajuste anti-fraude: el
  cajero conserva el cierre ciego; el saldo esperado se redacta también en la
  respuesta API mientras su sesión está abierta.
- **AC**: delta en vivo por denominación para manager/admin; conteo cero y
  estados transitorios no numéricos cubiertos; cajero sin saldo esperado en
  UI ni payload; sin cambiar la validación de cierre del servidor.

---

## 6. TRACK D — Modelos de DB nuevos (Drizzle, listos para migración)

### WC-D1 · Listas de precios + reglas (núcleo de ENG-109) `[checkout]` — **L**

El retail LatAm vive de precio mayorista/minorista y promos simples. Sustituye
a largo plazo los 3 tiers + 6 columnas de margen hardcodeadas en `products`.

```ts
export const priceLists = sqliteTable(
  'price_lists',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(), // "Minorista", "Mayorista"
    currencyCode: text('currency_code')
      .notNull()
      .default('COP')
      .references(() => currencyCatalog.code),
    priority: integer('priority').notNull().default(0), // desempate: mayor gana
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    validFrom: text('valid_from'),
    validTo: text('valid_to'), // promos con fecha
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  t => [index('idx_price_lists_tenant').on(t.tenantId)]
);

export const priceListItems = sqliteTable(
  'price_list_items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    priceListId: text('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    unitId: text('unit_id').references(() => units.id), // precio por empaque
    price: real('price').notNull(), // 2-dec check
    minQuantity: real('min_quantity').notNull().default(0), // escalón x cantidad
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  t => [
    uniqueIndex('idx_pli_scope').on(
      t.tenantId,
      t.priceListId,
      t.productId,
      t.unitId,
      t.minQuantity
    ),
    index('idx_pli_product').on(t.productId),
    ...moneyPositiveChecks('pli_price', t.price),
  ]
);

// Asignación: qué lista aplica a qué (sede | cliente). NULL = default tenant.
export const priceListAssignments = sqliteTable(
  'price_list_assignments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    priceListId: text('price_list_id')
      .notNull()
      .references(() => priceLists.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id),
    customerId: text('customer_id').references(() => customers.id),
    createdAt: text('created_at').notNull(),
  },
  t => [index('idx_pla_tenant').on(t.tenantId)]
);
```

**Resolución de precio** (pura, testeable): candidatos = items activos y
vigentes para (producto, unidad) cuyas listas asignan a la (sede | cliente) o
son default → filtrar `minQuantity ≤ qty` → mayor `priority`, luego mayor
`minQuantity`. **Invariante**: `sale_items` sigue snapshoteando `unitPrice` —
cambiar una lista jamás reescribe historia. Sync: `manual` (dinero).
**Compat**: los 3 tiers actuales se migran como lista "General" con 3
escalones; las columnas legacy quedan derivadas hasta deprecarse.

### WC-D2 · Lealtad mínima viable (núcleo de ENG-108) `[checkout]` — **M**

Ledger append-only, mismo patrón que `sale_item_lots` (auditable, snapshot):

```ts
export const loyaltyAccounts = sqliteTable(
  'loyalty_accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    points: real('points').notNull().default(0), // saldo materializado
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  t => [uniqueIndex('idx_loy_customer').on(t.tenantId, t.customerId)]
);

export const loyaltyMovements = sqliteTable(
  'loyalty_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    accountId: text('account_id')
      .notNull()
      .references(() => loyaltyAccounts.id),
    saleId: text('sale_id').references(() => sales.id), // null = ajuste manual
    kind: text('kind', { enum: ['earn', 'redeem', 'adjust', 'expire'] }).notNull(),
    points: real('points').notNull(), // con signo
    createdAt: text('created_at').notNull(),
  },
  t => [index('idx_loym_account').on(t.accountId)]
);
```

Regla v1: `earn = floor(total / rate)` con `rate` en tenant settings; redimir
= tender `loyalty` en `sale_payments` (el enum de método ya es extensible).
Reversa de venta revierte el earn (mismo patrón `restoreLotsForSale`).

### WC-D3 · Grano bin/ubicación en balances (staged en INVENTORY-MODEL) `[stock]` — **M**

Delta mínimo, aditivo: `inventory_balances` gana `locationId text NULL
references locations.id`; el unique pasa de `(tenant, site, product)` a
`(tenant, site, product, location)` con `location_id` NULL = grano actual
(migración con `IF NOT EXISTS` + backfill NULL, patrón 0007). El rollup WC-A1
absorbe el cambio sin tocar lectores. Product-gated: activarlo cuando un
piloto lo pida.

### WC-D4 · Números de serie (staged) `[stock][audit]` — **M**

```ts
export const productSerials = sqliteTable(
  'product_serials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    serial: text('serial').notNull(),
    status: text('status', { enum: ['in_stock', 'sold', 'returned', 'defective'] })
      .notNull()
      .default('in_stock'),
    saleItemId: text('sale_item_id').references(() => saleItems.id), // provenance
    receivedAt: text('received_at').notNull(),
    soldAt: text('sold_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  t => [uniqueIndex('idx_serial_scope').on(t.tenantId, t.productId, t.serial)]
);
```

Gate `products.tracksSerials` (mismo patrón `tracksLots`). Venta exige escoger
serial; garantía = lookup por serial. Product-gated (electrónica/herramienta).

---

## 7. TRACK E — Testeabilidad

### WC-E1 · Property-based tests en los invariantes de dinero/stock — **S** ⭐

- `fast-check` (dev-dep) sobre: (1) `roundMoney` — idempotencia, simetría de
  signo, |x−round(x)| < 0.005; (2) `selectLotsFefo` — Σ(allocations) + shortfall
  ≡ pedido, orden FEFO estable, totalCost ≡ Σ(qty×cost); (3) resolución de
  precios cuando exista WC-D1. Los golden vectors actuales se quedan; esto
  cubre el espacio que ellos no.
- **AC de ENG-196**: suites de dinero y FEFO integradas al `test:coverage`
  normal; 1 000 ejecuciones por propiedad de dinero y 500 por propiedad FEFO
  (miles de casos totales, < 5 s). La tercera suite queda ligada a WC-D1,
  porque la resolución de listas de precios todavía no existe.

### WC-E2 · Contract snapshot del API surface — **S**

- Test que serializa (nombre → tipo input/output resumido) de todos los
  procedures del `appRouter` y lo compara contra un snapshot commiteado.
  Un cambio de contrato se vuelve un diff de PR visible, no una sorpresa del
  cliente. Mismo espíritu que el manifest de sync (que ya lo hace bien).
- **AC**: renombrar/borrar un procedure rompe el test con mensaje claro.

### WC-E3 · E2E Playwright de los 3 flujos de dinero en pre-release — **M**

- Los suites e2e existen pero son local-only. Añadir un job manual-dispatch
  (no en push/PR — respeta el presupuesto de minutos) que corra login + venta
  - cierre de caja + devolución, requerido por `release.yml` antes de empacar.
- **AC**: `release.yml` depende del job e2e-web verde.

---

## 8. TRACK F — Simplicidad y deuda dirigida

| Id    | Acción                                                                                                                                               | Esfuerzo |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| WC-F1 | Ejecutar WC-B5 (podar no-ops de reconcile)                                                                                                           | S        |
| WC-F2 | Marcar price tiers/margins legacy `@deprecated` cuando WC-D1 aterrice; regla ESLint que bloquee nuevos usos                                          | S        |
| WC-F3 | Mantener el tracking Electron 42 (better-sqlite3 #1474) y el plan N-API — ya documentado en AGENTS.md, no requiere acción hasta upstream             | —        |
| WC-F4 | `sale_payments`/`sale_returns`: decidir la serialización agregada de venta para sync (hoy placeholders); documentar la decisión en ADR-0004 addendum | M        |

---

## 9. Orden recomendado para la Iteración 2

**Regla**: primero lo que desbloquea venta, luego los quick wins de deleite
(S), luego los cimientos (M/L). Cada fila es un slice/PR independiente.

| #   | Item                                                                                                                            | Esfuerzo | Pilar                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------- |
| 1   | TRACK P — ENG-057 → 058 → 060/061/062 (compuertas del piloto)                                                                   | L        | fiscal/offline        |
| 2   | ✅ WC-A4 enqueue sync de lotes en venta — ENG-192 shipped 2026-07-09                                                            | S        | offline               |
| 3   | ✅ WC-C2 sonido de checkout — ENG-193 shipped 2026-07-09                                                                        | S        | checkout              |
| 4   | ✅ WC-C9 semáforo de cuadre en vivo (role-gated: se preserva el cierre ciego del cajero) — ENG-194 shipped 2026-07-09           | S        | caja                  |
| 5   | ✅ WC-C6 semáforo de margen (modo dueño) — ENG-195 shipped 2026-07-09                                                           | S        | stock                 |
| 6   | ✅ WC-E1 property-based (dinero + FEFO) — ENG-196 shipped 2026-07-09                                                            | S        | audit                 |
| 7   | ✅ WC-A1 rollup de stock materializado (vía triggers 0008, no write-through — ver ROADMAP ENG-197) — ENG-197 shipped 2026-07-09 | M        | stock                 |
| 8   | ✅ WC-C1 cierre de día en 60 segundos (ritual post-cierre con margen real + racha, role-gated) — ENG-198 shipped 2026-07-10 ⭐  | M        | caja                  |
| 9   | ✅ WC-C3 radar de vencimientos (tab Inventario + sugerencia de descuento auditada + badge POS) — ENG-199 shipped 2026-07-10 ⭐  | M        | stock                 |
| 10  | ✅ WC-A3 sales Lighthouse floor + deferred payment drawer — ENG-200 shipped 2026-07-11                                          | S/M      | checkout              |
| 11  | ✅ WC-B4 desglose desktop main/index.ts — ENG-201 shipped 2026-07-11                                                           | S/M      | mantenibilidad        |
| 12  | WC-C7 primera venta en 5 min                                                                                                    | M        | checkout              |
| 13  | WC-B2 packages/shared                                                                                                           | M        | mantenibilidad        |
| 14  | WC-B3 FiscalProvider interface                                                                                                  | M        | fiscal                |
| 15  | WC-D1 listas de precios (con WC-F2)                                                                                             | L        | checkout              |
| 16  | WC-C5 omnibox de venta                                                                                                          | M        | checkout              |
| 17  | WC-D2 lealtad mínima                                                                                                            | M        | checkout              |
| 18  | WC-B1 application/ por fases                                                                                                    | L        | mantenibilidad        |
| 19  | WC-A2 SSE backpressure                                                                                                          | M        | offline               |
| 20  | WC-D3/WC-D4 bins + seriales                                                                                                     | M        | stock (product-gated) |

**Flujo**: cada item que se ejecute se promueve a `ROADMAP.md §3b` como
`ENG-NNN` con AC copiadas de este doc (ids libres desde ENG-192), vía
`/puntovivo-ship`. Este doc es la fuente; ROADMAP es el estado.

---

## 10. Lo que NO hacer (anti-recomendaciones)

- **No migrar a Postgres/cloud-first** — destruiría el diferencial `[offline]`.
  El camino de escala es el spike libSQL/Turso (ENG-037) manteniendo SQLite
  embebido como autoridad.
- **No añadir framer-motion ni una lib de animación** — los tokens de motion
  CSS existentes cubren el caso; presupuesto de bundle es un gate.
- **No gamificar con puntos/insignias al cajero** — el HUD es ritmo personal
  opt-in; rankings entre empleados generan gaming del sistema en retail.
- **No reescribir los 3 price tiers "ya"** — conviven con WC-D1 hasta que las
  listas prueben adopción; migración forzada rompe compat de API sin ganancia.
- **No adoptar un ORM/query-builder distinto** — Drizzle 0.45 está fresco y el
  equipo ya domina sus footguns (documentados en AGENTS.md).
